/**
 * Anton Terminal — agent process entrypoint.
 *
 * Runs the live trading loop and publishes every event to the realtime bus:
 *   ingestion → screening → DeepSeek decision → (dry-run) position → publish
 *
 * Bus + realtime transport:
 *   - REDIS_URL (non-default) → RedisEventBus; a separate @anton/realtime
 *     server subscribes to the same Redis to reach the dashboard.
 *   - otherwise → InMemoryEventBus + an embedded realtime server in THIS
 *     process, so agent → bus → dashboard works in one command, no Docker.
 *
 * Real APIs are used when keys exist (DeepSeek, Helius RPC, DexScreener,
 * RugCheck); each stage otherwise falls back to a safe offline path so the
 * pipeline always streams.
 */

import {
  InMemoryEventBus,
  RedisEventBus,
  createRealtimeServer,
  type EventBus,
  type RealtimeServerHandle,
} from "@anton/realtime";
import { loadEnv, parseTradingConfig, type TradingConfig } from "@anton/config";
import {
  createDb,
  insertBalanceSnapshot,
  listRecentBalanceSnapshots,
  type Database,
} from "@anton/data";
import { fetchCandidates } from "@anton/ingestion";
import { screenCandidate } from "@anton/screening";
import { decide, DeepSeekClient } from "@anton/agent";
import type {
  AgentState,
  BalancePointSnapshot,
  EnrichedCandidate,
  ScreeningResultEvent,
  StateSnapshotEvent,
} from "@anton/shared-types";
import { PositionBook } from "./positions.js";
import {
  publishDecision,
  publishHoldingsSnapshot,
  publishReasoningStep,
  publishScreening,
  publishStatus,
  publishWalletEntered,
} from "./publish.js";

const env = loadEnv();
const config: TradingConfig = parseTradingConfig({
  mode: env.ANTON_MODE,
  screeningPreset: "normal",
  minLiquidityUsd: 8000,
});

const REDIS_URL = env.REDIS_URL?.trim() ?? "";
const useRedis = REDIS_URL.length > 0 && REDIS_URL !== "redis://localhost:6379";
const DATABASE_URL = env.DATABASE_URL?.trim() ?? "";
const REALTIME_PORT = Number(process.env.REALTIME_PORT ?? 4000);
const CYCLE_MS = Number(process.env.ANTON_CYCLE_MS ?? 12_000);
const STARTING_SOL = Number(process.env.STARTING_SOL ?? 10);
const startedAt = Date.now();

function log(msg: string): void {
  process.stdout.write(`[anton] ${msg}\n`);
}

let step = 0;
function reason(bus: EventBus, thought: string, confidence?: number): void {
  step += 1;
  publishReasoningStep(bus, { step, thought, confidence, ts: Date.now() });
}

function status(bus: EventBus, state: AgentState): void {
  publishStatus(bus, { state, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
}

const MAX_BALANCE_POINTS = 240;
const balanceHistory: BalancePointSnapshot[] = [];

function snapshot(bus: EventBus, book: PositionBook, db?: Database): void {
  const totalPnlSol = book.totalPnlSol();
  const solBalance = STARTING_SOL + totalPnlSol;
  const ts = Date.now();

  publishHoldingsSnapshot(bus, {
    startingSol: STARTING_SOL,
    solBalance,
    totalPnlSol,
  });

  balanceHistory.push({ ts, solBalance });
  if (balanceHistory.length > MAX_BALANCE_POINTS) balanceHistory.shift();

  if (db) {
    insertBalanceSnapshot(db, {
      ts,
      solBalance,
      startingSol: STARTING_SOL,
      totalPnlSol,
    }).catch((err) => log(`balance persist: ${String(err).slice(0, 80)}`));
  }
}

function buildStateSnapshot(book: PositionBook): StateSnapshotEvent {
  const base = book.snapshotState();
  return {
    ...base,
    balanceHistory: [...balanceHistory],
    startingSol: STARTING_SOL,
  };
}

async function runCycle(bus: EventBus, book: PositionBook, deepseek?: DeepSeekClient): Promise<void> {
  status(bus, "scanning");
  const { candidates, source } = await fetchCandidates(12);
  reason(bus, `Scanning sources · ${candidates.length} candidates (${source})`, 0.5);

  // Filter out mints already in active positions BEFORE any expensive screening.
  // PositionBook.open() also guards internally, but skipping early saves
  // screenCandidate() + decide() calls on tokens we already hold.
  const fresh = candidates.filter((c) => !book.hasMint(c.mint));

  status(bus, "analyzing");
  const screened: Array<{
    candidate: EnrichedCandidate;
    report: Awaited<ReturnType<typeof screenCandidate>>;
    screeningEvt: ScreeningResultEvent;
  }> = [];

  // Screen ALL fresh candidates concurrently so every source contributes to
  // the live feed quickly. Each result is published the moment it resolves —
  // not after the whole batch — so slow RPC/RugCheck calls on one token do not
  // hold back the others. Per-token screening is independent, so the score and
  // verdict are identical to the sequential path.
  await Promise.all(
    fresh.map(async (candidate) => {
      const report = await screenCandidate(candidate, {
        rpcUrl: env.SOLANA_RPC_URL,
        preset: config.screeningPreset,
      });
      const screeningEvt: ScreeningResultEvent = {
        mint: report.mint,
        symbol: candidate.symbol,
        score: report.score,
        verdict: report.verdict,
        flags: report.flags,
        liquidityUsd: report.liquidityUsd ?? candidate.market.liquidityUsd,
        pairAgeSec: report.pairAgeSec ?? candidate.market.pairAgeSec,
        ts: report.ts,
        source: candidate.source,
      };
      publishScreening(bus, screeningEvt);
      screened.push({ candidate, report, screeningEvt });
    }),
  );

  // Only the strongest NSAFE candidates reach the decision engine.
  const safe = screened.filter((s) => s.screeningEvt.verdict === "SAFE").slice(0, 4);
  const decidedMints = new Set<string>();

  for (const r of safe) {
    if (decidedMints.has(r.candidate.mint)) continue;
    decidedMints.add(r.candidate.mint);

    for (const wallet of r.candidate.signals.smartWallets ?? []) {
      publishWalletEntered(bus, {
        wallet,
        trust: 0.7,
        mint: r.candidate.mint,
        priceUsd: r.candidate.market.priceUsd ?? 0,
        ts: Date.now(),
      });
    }

    const decision = await decide(
      { candidate: r.candidate, screening: r.report, config },
      {
        deepseek,
        onStep: (s) => reason(bus, s.thought, s.confidence),
      },
    );

    publishDecision(bus, {
      mint: decision.token,
      symbol: decision.symbol,
      action: decision.action,
      conviction: decision.confidence,
      sizeSol: decision.size_sol,
      reason: decision.reason,
    });

    if (decision.action === "BUY" && decision.size_sol) {
      if (book.atCapacity()) {
        reason(bus, `At max positions (${config.maxConcurrentPositions}) · skipping ${decision.symbol ?? ""}`);
      } else {
        status(bus, "entering");
        const opened = book.open(
          decision,
          r.candidate.market.priceUsd ?? 0,
          config.mode,
          r.candidate.market.marketCapUsd ?? r.candidate.market.fdvUsd,
        );
        if (opened) {
          reason(bus, `Opened ${config.mode} position ${decision.symbol ?? ""} · ${decision.size_sol} SOL`, decision.confidence);
        }
      }
    }
  }

  // Also screen rejected/caution tokens for wallet signals (already published above).
  for (const s of screened) {
    if (decidedMints.has(s.candidate.mint)) continue;
    for (const wallet of s.candidate.signals.smartWallets ?? []) {
      publishWalletEntered(bus, {
        wallet,
        trust: 0.5,
        mint: s.candidate.mint,
        priceUsd: s.candidate.market.priceUsd ?? 0,
        ts: Date.now(),
      });
    }
  }

  status(bus, "watching");
}

async function bootstrap(): Promise<void> {
  log(`starting in ${config.mode} mode`);
  log(`deepseek: ${env.DEEPSEEK_API_KEY ? "configured" : "fallback (rule-based)"}`);
  log(`rpc: ${env.SOLANA_RPC_URL ? "configured" : "heuristic-only screening"}`);

  const bus: EventBus = useRedis ? new RedisEventBus(REDIS_URL) : new InMemoryEventBus();
  const deepseek = env.DEEPSEEK_API_KEY
    ? new DeepSeekClient({ apiKey: env.DEEPSEEK_API_KEY })
    : undefined;

  let db: Database | undefined;
  let dbClient: { end: () => Promise<void> } | undefined;
  if (DATABASE_URL.length > 0) {
    try {
      const created = createDb(DATABASE_URL);
      db = created.db;
      dbClient = created.client;
      log("postgres: connected (positions persist across restarts)");
    } catch (err) {
      log(`postgres: unavailable, running in-memory only · ${String(err).slice(0, 80)}`);
    }
  } else {
    log("postgres: no DATABASE_URL, running in-memory only");
  }

  const book = new PositionBook(
    bus,
    {
      maxConcurrentPositions: config.maxConcurrentPositions,
      preventDuplicateMint: config.preventDuplicateMint,
    },
    { db, onError: log },
  );

  if (db) {
    try {
      await book.loadFromDb();
      log(`restored ${book.count} open position(s) from postgres`);
    } catch (err) {
      log(`postgres restore failed: ${String(err).slice(0, 80)}`);
    }
    try {
      const points = await listRecentBalanceSnapshots(db, MAX_BALANCE_POINTS);
      balanceHistory.push(...points.map((p) => ({ ts: p.ts, solBalance: p.solBalance })));
      log(`restored ${balanceHistory.length} balance point(s) from postgres`);
    } catch (err) {
      log(`balance restore failed: ${String(err).slice(0, 80)}`);
    }
  }

  let server: RealtimeServerHandle | undefined;
  if (!useRedis) {
    server = createRealtimeServer(bus, {
      port: REALTIME_PORT,
      busLabel: "in-memory (embedded)",
      getSnapshot: () => buildStateSnapshot(book),
    });
    log(`embedded realtime server → http://localhost:${REALTIME_PORT}`);
  } else {
    log(`using Redis bus — run @anton/realtime separately for the UI`);
  }

  const POLL_MS = Number(process.env.ANTON_POLL_MS ?? 3000);
  let polling = false;
  const tickTimer = setInterval(() => {
    if (polling) return; // skip overlap: a slow fetch must not stack polls
    polling = true;
    void book
      .poll()
      .catch((err) => log(`poll error: ${String(err).slice(0, 80)}`))
      .finally(() => {
        polling = false;
      });
  }, POLL_MS);

  let running = true;
  const loop = async (): Promise<void> => {
    // Give Socket.IO clients (dashboard) time to connect before the first
    // cycle so screening + position events are not lost.
    await new Promise((r) => setTimeout(r, 500));
    log("agent loop starting (500ms startup delay)");
    while (running) {
      try {
        await runCycle(bus, book, deepseek);
      } catch (err) {
        log(`cycle error: ${String(err)}`);
        reason(bus, `Cycle error: ${String(err).slice(0, 80)}`);
      }
      snapshot(bus, book, db);
      await new Promise((r) => setTimeout(r, CYCLE_MS));
    }
  };
  void loop();
  log(`decision cycle every ${CYCLE_MS}ms`);

  const shutdown = (signal: string): void => {
    log(`${signal} received, shutting down`);
    running = false;
    clearInterval(tickTimer);
    server?.close();
    void bus.close();
    void dbClient?.end();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`[anton] fatal: ${String(err)}\n`);
  process.exit(1);
});
