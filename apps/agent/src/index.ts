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
import { decide, decideExit, DeepSeekClient, type ReasoningStep } from "@anton/agent";
import { loadHotWallet, createConnection, LAMPORTS_PER_SOL } from "@anton/solana";
import { swapBuy } from "@anton/solana";
import { swapSell } from "@anton/solana";
import { getTokenBalance } from "@anton/solana";
import { SOL_MINT } from "@anton/solana";
import { HeliusPriceFeed } from "@anton/solana";
import { WalletIntel } from "@anton/solana";
import type {
  AgentState,
  BalancePointSnapshot,
  EnrichedCandidate,
  ScreeningResultEvent,
  StateSnapshotEvent,
  TokenPhase,
  TokenSource,
} from "@anton/shared-types";
import { PositionBook } from "./positions.js";
import { reflectOnClose } from "./learn.js";
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
  maxConcurrentPositions: Number(process.env.ANTON_MAX_CONCURRENT_POSITIONS ?? 3),
  minSpendSol: Number(process.env.ANTON_MIN_SPEND_SOL ?? 0.1),
  maxSpendSol: Number(process.env.ANTON_MAX_SPEND_SOL ?? 0.15),
});

const MAX_TRADES_PER_DAY = 10;
let tradesToday = 0;
let tradeDayReset = Date.now();

const REDIS_URL = env.REDIS_URL?.trim() ?? "";
const useRedis = REDIS_URL.length > 0 && REDIS_URL !== "redis://localhost:6379";
const DATABASE_URL = env.DATABASE_URL?.trim() ?? "";
const REALTIME_PORT = Number(process.env.REALTIME_PORT ?? 4000);
const CYCLE_MS = Number(process.env.ANTON_CYCLE_MS ?? 12_000);
let STARTING_SOL = Number(process.env.STARTING_SOL ?? 10);
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
let lastWalletBalance = STARTING_SOL;
const reflectedPositionIds = new Set<string>();
const recentlyClosedMints = new Map<string, { closedAt: number; wasProfit: boolean }>();
const watchlistCounts = new Map<string, { count: number; symbol?: string; liquidityUsd?: number; pairAgeSec?: number; score: number; momentum: number }>();
let db: Database | undefined;
let walletIntel: WalletIntel | undefined;

async function fetchWalletBalance(): Promise<void> {
  if (!env.SOLANA_PRIVATE_KEY || !env.SOLANA_RPC_URL) return;
  const wallet = loadHotWallet(env.SOLANA_PRIVATE_KEY);
  const connection = createConnection(env.SOLANA_RPC_URL);
  const lamports = await connection.getBalance(wallet.publicKey);
  lastWalletBalance = lamports / LAMPORTS_PER_SOL;
}

function snapshot(bus: EventBus, book: PositionBook, db?: Database): void {
  const totalPnlSol = book.totalPnlSol();
  const solBalance = config.mode === "live" ? lastWalletBalance : STARTING_SOL + totalPnlSol;
  const ts = Date.now();

  publishHoldingsSnapshot(bus, {
    startingSol: STARTING_SOL,
    solBalance,
    totalPnlSol,
    watchlist: [...watchlistCounts.entries()]
      .filter(([_, w]) => w.count === 1)
      .map(([mint, w]) => ({ mint, symbol: w.symbol, cycleCount: w.count, momentum: w.momentum, score: w.score, liquidityUsd: w.liquidityUsd, pairAgeSec: w.pairAgeSec }))
      .slice(0, 10),
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

async function buildStateSnapshot(book: PositionBook): Promise<StateSnapshotEvent> {
  const base = book.snapshotState();
  const result: StateSnapshotEvent = {
    ...base,
    balanceHistory: [...balanceHistory],
    startingSol: STARTING_SOL,
    mode: config.mode,
    watchlist: [...watchlistCounts.entries()]
      .filter(([_, w]) => w.count === 1)
      .map(([mint, w]) => ({
        mint,
        symbol: w.symbol,
        cycleCount: w.count,
        momentum: w.momentum,
        score: w.score,
        liquidityUsd: w.liquidityUsd,
        pairAgeSec: w.pairAgeSec,
      }))
      .slice(0, 10),
  };

  if (db) {
    try {
      const { getRecentLessons, getPatternStats, getSmartWalletCount } = await import("@anton/data");
      result.recentLessons = await getRecentLessons(db, 20);
      const stats = await getPatternStats(db);
      result.patternStats = stats;
      result.smartWalletCount = await getSmartWalletCount(db);
    } catch {
      // Non-fatal — return snapshot without learning data
    }
  }

  return result;
}

async function runCycle(bus: EventBus, book: PositionBook, deepseek?: DeepSeekClient): Promise<void> {
  status(bus, "scanning");
  const { candidates: rawCandidates, source } = await fetchCandidates(12);
  const candidates = rawCandidates.filter((c) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.mint));
  reason(bus, `Scanning sources · ${candidates.length} candidates (${source})`, 0.5);

  // Filter out mints recently closed (5 min cooldown) + already active
  const COOLDOWN_MS = 300_000;
  const fresh = candidates.filter((c) => {
    if (book.hasMint(c.mint)) return false;
    const closed = recentlyClosedMints.get(c.mint);
    if (closed) {
      const cooldown = closed.wasProfit ? 1_800_000 : 300_000; // 30min profit, 5min loss
      if (Date.now() - closed.closedAt < cooldown) return false;
    }
    return true;
  });

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

  // Only the strongest SAFE candidates reach the decision engine.
  // Holder quality gate: reject concentrated distribution (top10 > 60%).
  const safe = screened
    .filter((s) => s.screeningEvt.verdict === "SAFE")
    .filter((s) => {
      const top10 = s.report.top10Pct;
      if (top10 !== undefined && top10 > 60) {
        reason(bus, `👥 ${s.candidate.symbol ?? s.candidate.mint.slice(0, 6)} rejected — top 10 holders own ${top10.toFixed(0)}% (whale dump risk)`, 0.7);
        return false;
      }
      return true;
    })
    .slice(0, 4);

  // Watchlist: update for SAFE candidates only — skip non-Solana addresses
  const SOL_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  for (const s of safe) {
    const c = s.candidate;
    if (!SOL_MINT_REGEX.test(c.mint)) continue;
    const existing = watchlistCounts.get(c.mint);
    watchlistCounts.set(c.mint, {
      count: (existing?.count ?? 0) + 1,
      symbol: c.symbol ?? existing?.symbol,
      liquidityUsd: s.screeningEvt.liquidityUsd ?? existing?.liquidityUsd,
      pairAgeSec: s.screeningEvt.pairAgeSec ?? existing?.pairAgeSec,
      score: s.screeningEvt.score,
      momentum: c.market.momentum ?? existing?.momentum ?? 0,
    });
  }
  // Cleanup old counts periodically
  if (watchlistCounts.size > 500) {
    for (const [mint, w] of watchlistCounts) {
      if (w.count <= 3) watchlistCounts.delete(mint);
    }
  }

  // Only allow BUY on tokens seen 2+ cycles (anti-FOMO)
  // Track peak momentum — enter on pullback from peak (not FOMO top)
  const peakMomentum = new Map<string, number>();
  const eligible = safe.filter((s) => {
    const w = watchlistCounts.get(s.candidate.mint);
    const count = w?.count ?? 0;
    const mom = s.candidate.market.momentum ?? 0;
    const prevPeak = peakMomentum.get(s.candidate.mint) ?? 0;

    if (mom > prevPeak) peakMomentum.set(s.candidate.mint, mom);

    if (count < 2) {
      reason(bus, `👀 ${s.candidate.symbol ?? s.candidate.mint.slice(0, 6)} on watchlist — cycle ${count}/2 (momentum ${(mom*100).toFixed(1)}%)`, 0.5);
      return false;
    }

    // Pullback check: don't buy at momentum peak, wait for dip
    if (prevPeak > mom * 1.5) {
      reason(bus, `↘️ ${s.candidate.symbol ?? s.candidate.mint.slice(0, 6)} pullback from peak ${(prevPeak*100).toFixed(1)}% to ${(mom*100).toFixed(1)}% — entering dip`, 0.6);
    }

    return true;
  });

  // ── Meme Coin Market Regime ──
  // Health gauged from agent's own recent closed trades (last 2h): how many
  // sustained (TP/profit) vs dumped (SL). This reflects the LIVE meme ecosystem,
  // not BTC/SOL. Combined with current candidate momentum distribution.
  const recentClosed = book.snapshotState().history.filter(
    (h) => h.closedAt && Date.now() - h.closedAt < 7200_000,
  );
  const sustainCount = recentClosed.filter((h) => h.pnlSol > 0).length;
  const dumpCount = recentClosed.filter((h) => h.pnlPct <= -10).length;
  const sustainRate = recentClosed.length >= 5
    ? sustainCount / recentClosed.length
    : -1; // cold start / insufficient data

  const allMomentum = screened
    .map((s) => s.candidate.market.momentum ?? 0)
    .filter((m) => m !== 0);
  const bullishRatio = allMomentum.length > 0
    ? allMomentum.filter((m) => m > 0.02).length / allMomentum.length
    : 0.5;

  let regime: "bullish" | "sideways" | "bearish";
  if (sustainRate >= 0.45 && bullishRatio > 0.4) regime = "bullish";
  else if (sustainRate < 0 || sustainRate < 0.25 || (dumpCount >= 6 && sustainRate < 0.35)) regime = "bearish";
  else regime = "sideways";

  if (regime === "bearish") {
    reason(bus, `🐻 MEME MARKET BEARISH · sustain ${(sustainRate * 100).toFixed(0)}% · ${dumpCount} dumps/2h — skipping entries, waiting for healthier conditions`, 0.9);
    status(bus, "watching");
    return;
  }

  // Daily trade cap
  if (Date.now() - tradeDayReset > 86400_000) { tradesToday = 0; tradeDayReset = Date.now(); }
  if (tradesToday >= MAX_TRADES_PER_DAY) {
    reason(bus, `📊 Daily trade cap reached (${MAX_TRADES_PER_DAY}/day) — waiting for next cycle`, 0.8);
    status(bus, "watching");
    return;
  }

  if (regime === "sideways") {
    reason(bus, `↔️ Market regime: SIDEWAYS (${(bullishRatio * 100).toFixed(0)}% bullish) — high conviction only`, 0.6);
  }
  const decidedMints = new Set<string>();

  // Gather portfolio context for enriched LLM decisions
  const portfolioSnap = book.snapshotState();
  const openForLLM = portfolioSnap.positions.map(p => ({
    symbol: p.symbol,
    pnlPct: p.pnlPct,
    sizeSol: p.sizeSol,
    openedAt: p.openedAt,
  }));
  const realizedToday = portfolioSnap.history
    .filter(h => h.closedAt && (Date.now() - h.closedAt) < 86400_000)
    .reduce((sum, h) => sum + h.pnlSol, 0);
  const remainingBudget = config.mode === "live"
    ? Math.max(0, lastWalletBalance - portfolioSnap.positions.reduce((s, p) => s + p.sizeSol, 0))
    : Math.max(0, STARTING_SOL + book.totalPnlSol());
  const dailyLossExceeded = realizedToday <= -(config.maxDailyLossSol ?? 2);

  // Fetch learning context: lessons + pattern stats
  let recentLessons: string[] | undefined;
  let patternStatsSummary: string | undefined;
  if (db) {
    try {
      const { getRecentLessons, getPatternStats } = await import("@anton/data");
      const lessons = await getRecentLessons(db, 5);
      recentLessons = lessons.map((l) => `[${l.severity}] ${l.summary}`);

      const stats = await getPatternStats(db);
      if (stats.length > 0) {
        const lines = stats.slice(0, 8).map((s) =>
          `${s.category}/${s.key}: ${s.totalWins}W/${s.totalLosses}L (${s.winRate ? (s.winRate * 100).toFixed(0) + "%" : "N/A"} WR, avg ${s.avgPnlPct.toFixed(1)}% PnL)`
        );
        patternStatsSummary = lines.join("\n");
      }
    } catch {
      // Non-fatal — continue without learning context
    }
  }

  for (const r of eligible) {
    if (decidedMints.has(r.candidate.mint)) continue;
    decidedMints.add(r.candidate.mint);

    // ── Smart-money wallet intelligence ──
    if (walletIntel && db) {
      try {
        const { getWalletScores, recordWalletSwap } = await import("@anton/data");
        const scores = await getWalletScores(db, []); // will use analyze's internal fetch
        const intel = await walletIntel.analyze(r.candidate.mint, scores);

        if (intel.buyers.length > 0) {
          // Record all buyers
          for (const b of intel.buyers) {
            await recordWalletSwap(db, {
              wallet: b.wallet,
              mint: r.candidate.mint,
              side: "BUY",
              tokenAmount: b.tokenDelta,
              ts: b.ts,
            }).catch(() => {});
          }

          // Smart money signal
          r.candidate.signals.smartWallets = intel.smartBuyers;
          if (intel.smartBuyers.length > 0) {
            reason(bus, `💰 ${intel.smartBuyers.length} smart wallet(s) detected on ${r.candidate.symbol ?? r.candidate.mint.slice(0, 6)}`, 0.8);
          }

          // Bundle warning
          if (intel.bundledCount > 0) {
            reason(bus, `🎭 BUNDLE detected on ${r.candidate.symbol ?? r.candidate.mint.slice(0, 6)}: ${intel.bundledCount} wallet(s) from same funder — likely sniper/insider`, 0.75);
          }

          // Fresh wallet warning
          if (intel.freshWalletCount > 0) {
            reason(bus, `🆕 ${intel.freshWalletCount} fresh wallet(s) (< 5 txns) detected — possible bot/sybil`, 0.7);
          }
        }

        if (intel.rateLimited) {
          log("⚠ wallet-intel rate limited — reduce trade frequency or switch API key");
        }
      } catch {
        // Non-fatal
      }
    }

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
      {
        candidate: r.candidate,
        screening: r.report,
        config,
        openPositions: openForLLM,
        remainingBudgetSol: remainingBudget,
        realizedPnlSol: realizedToday,
        recentLessons,
        patternStatsSummary,
      },
      {
        deepseek,
        onStep: (s) => reason(bus, s.thought, s.confidence),
      },
    );

    // Only publish actionable decisions (BUY/EXIT) — SKIP/HOLD are noise
    if (decision.action === "BUY" || decision.action === "EXIT") {
      publishDecision(bus, {
        mint: decision.token,
        symbol: decision.symbol,
        action: decision.action,
        conviction: decision.confidence,
        sizeSol: decision.size_sol,
        reason: decision.reason,
      });
    }

    // Update screening row with LLM decision (BUY or SKIP)
    publishScreening(bus, {
      ...r.screeningEvt,
      llmAction: decision.action === "BUY" ? "BUY" : "SKIP",
    });

    if (decision.action === "BUY" && decision.size_sol) {
      // Sideways market: high conviction only
      if (regime === "sideways" && decision.confidence < 0.7) {
        reason(bus, `↔️ Sideways market — skipping ${decision.symbol ?? ""} (conviction ${decision.confidence.toFixed(2)} < 0.7)`, decision.confidence);
        continue;
      }

      if (dailyLossExceeded) {
        reason(bus, `⛔ Daily loss cap ${config.maxDailyLossSol} SOL reached (${realizedToday.toFixed(3)}) · skipping ${decision.symbol ?? ""}`, 0.9);
      } else if (book.atCapacity()) {
        reason(bus, `At max positions (${config.maxConcurrentPositions}) · skipping ${decision.symbol ?? ""}`);
      } else {
        status(bus, "entering");
        const opened = await book.open(
          decision,
          r.candidate.market.priceUsd ?? 0,
          config.mode,
          r.candidate.market.marketCapUsd ?? r.candidate.market.fdvUsd,
        );
        if (opened) {
          tradesToday++;
          reason(bus, `Opened ${config.mode} position ${decision.symbol ?? ""} · ${decision.size_sol} SOL (${tradesToday}/${MAX_TRADES_PER_DAY} today)`, decision.confidence);
        } else {
          reason(bus, `⛔ Swap failed for ${decision.symbol ?? ""} — check liquidity or pool availability`, 0.6);
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

  // LLM re-evaluation of open positions for early exit signals
  if (deepseek && portfolioSnap.positions.length > 0) {
    for (const pos of portfolioSnap.positions) {
      const posAgeSec = (Date.now() - pos.openedAt) / 1000;
      if (posAgeSec < 300) continue;

      try {
        const exitDecision = await decideExit(
          {
            symbol: pos.symbol,
            mint: pos.mint,
            pnlPct: pos.pnlPct,
            entryPriceUsd: pos.entryPriceUsd,
            currentPriceUsd: pos.currentPriceUsd,
            sizeSol: pos.sizeSol,
            slPct: pos.slPct,
            tpPct: pos.tpPct,
            ageSec: posAgeSec,
          },
          { momentum: undefined, priceChange5mPct: undefined, volume5mUsd: undefined },
          {
            deepseek,
            onStep: (s: ReasoningStep) => reason(bus, `[re-eval ${pos.symbol ?? pos.mint.slice(0, 6)}] ${s.thought}`, s.confidence),
          },
        );

        if (exitDecision.action === "EXIT") {
          const closed = await book.exitPosition(pos.id, `llm-exit: ${exitDecision.reason}`);
          if (closed) {
            reason(bus, `🔄 LLM exit: ${pos.symbol ?? pos.mint.slice(0, 8)} at ${pos.pnlPct.toFixed(1)}% — ${exitDecision.reason}`, exitDecision.confidence);
          }
        }
      } catch {
        // Exit evaluation failures are non-fatal — mechanical stops remain active
      }
    }
  }

  // Reflect on newly closed positions — learn from every trade
  if (db && deepseek) {
    const history = book.snapshotState().history;
    for (const closed of history) {
      if (reflectedPositionIds.has(closed.id)) continue;
      reflectedPositionIds.add(closed.id);
      recentlyClosedMints.set(closed.mint, {
        closedAt: Date.now(),
        wasProfit: closed.pnlSol > 0,
      });

      // Score wallets that bought this token based on its outcome
      void (async () => {
        if (!db) return;
        try {
          const { getWalletsForMint, upsertWalletScore } = await import("@anton/data");
          const wallets = await getWalletsForMint(db, closed.mint);
          const delta = closed.pnlSol > 0 ? 0.05 : -0.03;
          for (const w of wallets) {
            await upsertWalletScore(db, { address: w, trustDelta: delta }).catch(() => {});
          }
        } catch {
          // Non-fatal
        }
      })();

      // Cleanup old cooldown entries periodically
      if (recentlyClosedMints.size > 200) {
        const cutoff = Date.now() - 1_800_000;
        for (const [mint, entry] of recentlyClosedMints) {
          if (entry.closedAt < cutoff) recentlyClosedMints.delete(mint);
        }
      }

      const holdSec = closed.closedAt && closed.openedAt
        ? Math.floor((closed.closedAt - closed.openedAt) / 1000)
        : 0;

      void reflectOnClose(
        {
          symbol: closed.symbol,
          mint: closed.mint,
          pnlPct: closed.pnlPct,
          pnlSol: closed.pnlSol,
          entryPriceUsd: closed.entryPriceUsd,
          exitPriceUsd: closed.closePriceUsd ?? closed.currentPriceUsd,
          sizeSol: closed.sizeSol,
          slPct: closed.slPct,
          tpPct: closed.tpPct,
          holdSec,
          reason: closed.reason ?? "unknown",
        },
        deepseek,
        db,
      );
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

  let priceFeed: HeliusPriceFeed | undefined;
  const wsUrl = process.env.SOLANA_RPC_WS?.trim() || env.SOLANA_RPC_URL;
  if (wsUrl) {
    try {
      // Ensure wss:// prefix for WebSocket
      const finalUrl = wsUrl.startsWith("wss://") ? wsUrl : wsUrl.replace("https://", "wss://");
      priceFeed = new HeliusPriceFeed(finalUrl);
      log("helius ws: real-time price feed active");
    } catch {
      log("helius ws: unavailable, falling back to dex screener polling");
    }
  }

  if (env.SOLANA_RPC_URL) {
    walletIntel = new WalletIntel(createConnection(env.SOLANA_RPC_URL), () => {
      log("⚠ wallet-intel rate limited — reduce trade frequency or switch API key");
    });
    log("wallet intel: smart-money detection active");
  }

  const book = new PositionBook(
    bus,
    {
      maxConcurrentPositions: config.maxConcurrentPositions,
      preventDuplicateMint: config.preventDuplicateMint,
    },
    {
      db,
      onError: log,
      priceFeed,
      swapSolForToken: env.SOLANA_PRIVATE_KEY && env.SOLANA_RPC_URL
        ? async (tokenMint: string, solAmount: number) => {
            const wallet = loadHotWallet(env.SOLANA_PRIVATE_KEY!);
            const connection = createConnection(env.SOLANA_RPC_URL!);
            const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
            const slippageBps = Number(process.env.JUPITER_SLIPPAGE_BPS ?? 2500);
            const result = await swapBuy({
              connection,
              wallet,
              inputMint: SOL_MINT,
              outputMint: tokenMint,
              amountLamports: lamports,
              slippageBps,
            });
            log(`swap BUY ${tokenMint.slice(0, 8)}... ${solAmount} SOL → ${result.txSignature.slice(0, 16)}...`);
            return { txSignature: result.txSignature };
          }
        : undefined,
      swapTokenForSol: env.SOLANA_PRIVATE_KEY && env.SOLANA_RPC_URL
        ? async (tokenMint: string, _solAmount: number) => {
            const wallet = loadHotWallet(env.SOLANA_PRIVATE_KEY!);
            const connection = createConnection(env.SOLANA_RPC_URL!);
            const balance = await getTokenBalance(connection, wallet.publicKey, tokenMint);
            if (!balance || balance.rawAmount === "0") {
              throw new Error(`no token balance for ${tokenMint.slice(0, 8)}`);
            }
            const slippageBps = Number(process.env.JUPITER_SLIPPAGE_BPS ?? 2500);
            const result = await swapSell(connection, wallet, tokenMint, balance.rawAmount, slippageBps);
            log(`swap SELL ${tokenMint.slice(0, 8)}... ${balance.uiAmount} tokens → ${result.txSignature.slice(0, 16)}...`);
            return { txSignature: result.txSignature };
          }
        : undefined,
    },
  );

  if (db) {
    try {
      await book.loadFromDb(config.mode);
      log(`restored ${book.count} open position(s) from postgres (mode: ${config.mode})`);
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

  if (config.mode === "live" && env.SOLANA_PRIVATE_KEY && env.SOLANA_RPC_URL) {
    await fetchWalletBalance();
    STARTING_SOL = lastWalletBalance;
    log(`wallet balance: ${STARTING_SOL} SOL (set as equity baseline)`);
  }

  let server: RealtimeServerHandle | undefined;
  if (!useRedis) {
    server = createRealtimeServer(bus, {
      port: REALTIME_PORT,
      busLabel: "in-memory (embedded)",
      getSnapshot: () => buildStateSnapshot(book),
      controls: {
        onSetMode: async (e) => {
          config.mode = e.mode;
          log(`control set_mode → ${e.mode}`);
          if (e.mode === "live" && env.SOLANA_PRIVATE_KEY && env.SOLANA_RPC_URL) {
            await fetchWalletBalance();
            STARTING_SOL = lastWalletBalance;
          }
          if (db) {
            await book.loadFromDb(e.mode);
            log(`reloaded positions for mode ${e.mode}: ${book.count} open`);
          }
        },
        onSetSpendLimits: (e) => {
          config.minSpendSol = e.minSol;
          config.maxSpendSol = e.maxSol;
          log(`control set_spend_limits → ${e.minSol}..${e.maxSol} SOL`);
        },
        onSetRiskConfig: (e) => {
          config.maxConcurrentPositions = e.maxConcurrent;
          config.maxDailyLossSol = e.dailyLossCapSol;
          config.defaultStopLossPct = e.defaultStopLossPct;
          config.defaultTakeProfitPct = e.defaultTakeProfitPct;
          config.screeningPreset = e.screeningPreset;
          log(`control set_risk_config → concurrent:${e.maxConcurrent} cap:${e.dailyLossCapSol} sl:${e.defaultStopLossPct}% tp:${e.defaultTakeProfitPct}% preset:${e.screeningPreset}`);
        },
        onEmergencyStop: () => {
          config.mode = "dry-run";
          log("control emergency_stop → forced dry-run, stopping all live activity");
          // Close all live positions immediately
          const snap = book.snapshotState();
          for (const pos of snap.positions) {
            if (pos.mode === "live") {
              book.forceClose(pos.id, pos.pnlPct, "emergency-stop").catch(() => {});
            }
          }
        },
      },
    });
    log(`embedded realtime server → http://localhost:${REALTIME_PORT}`);
  } else {
    log(`using Redis bus — run @anton/realtime separately for the UI`);
  }

  const POLL_MS = Number(process.env.ANTON_POLL_MS ?? 3000);
  let polling = false;
  const tickTimer = setInterval(() => {
    if (polling) return;
    polling = true;
    void book
      .poll()
      .catch((err) => log(`poll error: ${String(err).slice(0, 80)}`))
      .finally(() => {
        polling = false;
      });
  }, POLL_MS);

  const balTimer = setInterval(() => {
    if (config.mode === "live" && env.SOLANA_RPC_URL) {
      fetchWalletBalance()
        .then(() => {
          const totalPnlSol = book.totalPnlSol();
          const solBalance = lastWalletBalance;
          const ts = Date.now();
          publishHoldingsSnapshot(bus, {
            startingSol: STARTING_SOL,
            solBalance,
            totalPnlSol,
            watchlist: [...watchlistCounts.entries()]
              .filter(([_, w]) => w.count === 1)
              .map(([mint, w]) => ({ mint, symbol: w.symbol, cycleCount: w.count, momentum: w.momentum, score: w.score, liquidityUsd: w.liquidityUsd, pairAgeSec: w.pairAgeSec }))
              .slice(0, 10),
          });
          balanceHistory.push({ ts, solBalance });
          if (balanceHistory.length > MAX_BALANCE_POINTS) balanceHistory.shift();
        })
        .catch(() => {});
    }
  }, 3000);

  // Position reconciliation — check on-chain token balances for live positions
  // and auto-close any that were sold externally (manual wallet sell).
  const reconTimer = setInterval(async () => {
    if (config.mode !== "live" || !env.SOLANA_PRIVATE_KEY || !env.SOLANA_RPC_URL) return;
    if (book.count === 0) return;
    try {
      const wallet = loadHotWallet(env.SOLANA_PRIVATE_KEY);
      const connection = createConnection(env.SOLANA_RPC_URL);
      const snap = book.snapshotState();
      for (const pos of snap.positions) {
        if (pos.mode !== "live") continue;
        const balance = await getTokenBalance(connection, wallet.publicKey, pos.mint);
        if (!balance || balance.rawAmount === "0") {
          const pnlPct = ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
          await book.forceClose(pos.id, pnlPct, "manual-sell-detected");
          log(`reconciled: ${pos.symbol ?? pos.mint.slice(0, 8)} was sold externally → closed`);
        }
      }
    } catch (err) {
      log(`reconciliation error: ${String(err).slice(0, 80)}`);
    }
  }, 15_000);

  let running = true;
  const loop = async (): Promise<void> => {
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
    clearInterval(balTimer);
    clearInterval(reconTimer);
    server?.close();
    priceFeed?.close();
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
