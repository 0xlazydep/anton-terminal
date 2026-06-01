/**
 * Mock event producer — drives the realtime server WITHOUT a real agent,
 * Redis, or database. Publishes synthetic trading events onto the EventBus
 * on the same channels the real pipeline will use, so the dashboard receives
 * a fully "live" stream end-to-end (server → Socket.IO/SSE → UI).
 *
 * Channel/payload shapes mirror exactly what `socket-server.ts` and `sse.ts`
 * expect when bridging the bus to clients:
 *   - CHANNELS.trading      → { type, data }   (position_*, agent handled elsewhere)
 *   - CHANNELS.screening    → ScreeningResultEvent (raw)
 *   - CHANNELS.smartWallet  → { type: "wallet_entered" | "wallet_exited", data }
 *   - CHANNELS.status       → AgentStatusEvent (raw)
 *   - CHANNELS.reasoning    → { type: "reasoning_step" | "entry_decision" | "alert", data }
 */

import { CHANNELS } from "@anton/shared-types";
import type {
  AgentState,
  AgentStatusEvent,
  EntryDecisionEvent,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
  ReasoningStepEvent,
  ScreeningResultEvent,
  ScreeningVerdict,
  TradeAction,
  WalletEnteredEvent,
  WalletExitedEvent,
} from "@anton/shared-types";
import type { EventBus } from "./bus.js";

// ───────────────────────── PRNG (xorshift32) ─────────────────────────

let seed = 0x1a2b3c4d;
function rand(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100_000) / 100_000;
}
function randBetween(min: number, max: number): number {
  return min + (max - min) * rand();
}
function pick<T>(arr: readonly T[]): T {
  // arr is always non-empty at every call site below.
  return arr[Math.floor(rand() * arr.length)] as T;
}

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
function makeBase58(len = 44): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(rand() * CHARS.length)];
  return s;
}

const SYMBOLS = [
  "PEPE3", "WIFHAT", "BONK2", "MYRO", "POPCAT", "MOTHER", "GIGA", "PNUT",
  "GOAT", "CHILLGUY", "MOODENG", "FWOG", "PUNDU", "RETARDIO", "ANATOLY",
] as const;

const THOUGHTS = [
  "Scanning Pump.fun migrations · 12 new in last 60s",
  "Filtering by liquidity ≥ $25k · 4 candidates remain",
  "Pulling smart-wallet overlap for {SYM} · 3 tracked wallets entered ≤90s ago",
  "RugCheck pass · mint+freeze revoked · top-10 holders 18%",
  "DexScreener pair age 14m · vol 5m $48,210 · momentum +0.42",
  "Recalling lesson L-0931: similar volume curve, +27% in 8m last week",
  "Reasoning conviction = 0.71 · within size band [0.10, 0.42 SOL]",
  "Mirror entry detected from W-8f4a · trust 0.83 · size 0.31 SOL",
  "Honeypot heuristic clean · no blocked sells in last 200 txns",
  "Skipping {SYM} · holder concentration 71% top-10 · REJECT",
  "Position {SYM} TP1 hit at +28% · trailing remaining 50%",
  "Heartbeat OK · Helius latency 41ms · Jupiter latency 88ms",
  "Daily PnL +0.84 SOL · within loss cap · continuing entries",
] as const;

const DECISION_REASONS = [
  "3 tracked smart wallets entered within 90s; vol momentum +0.62; conviction 0.74",
  "Holder concentration acceptable (18% top-10), LP locked, pair age 14m — safe enough",
  "Mirroring W-8f4a (trust 0.83) — same entry band, same SL band — size matched",
  "Skip: liquidity dropped 22% since detection; risk asymmetry unfavorable",
  "Take profit triggered: realized +28% on 50% of position; trailing remainder",
  "Stop loss: drawdown breached -12% with smart-wallet exit; flatten",
  "Hold: thesis intact, momentum cooling but volume sustained",
] as const;

const FLAG_POOL = [
  "MINT_AUTH_REVOKED", "FREEZE_AUTH_REVOKED", "LP_LOCKED_82PCT", "TOP10_18PCT",
  "PAIR_AGE_14M", "VOL_5M_OK", "NO_HONEYPOT_SIG", "SMART_WALLETS_3",
] as const;
const REJECT_FLAGS = [
  "MINT_AUTH_LIVE", "TOP10_71PCT", "LOW_LIQ", "FREEZE_AUTH_LIVE",
] as const;

const AGENT_STATES: readonly AgentState[] = [
  "scanning", "analyzing", "entering", "watching", "idle",
];

// ───────────────────────── Internal position state ─────────────────────────

interface LivePosition extends PositionOpenedEvent {
  currentPriceUsd: number;
  slPct: number;
  tpPct: number;
  openedAt: number;
}

function makePosition(): LivePosition {
  const entryPriceUsd = randBetween(0.00002, 0.012);
  const drift = randBetween(-18, 42);
  return {
    id: `pos_${makeBase58(8)}`,
    mint: makeBase58(),
    symbol: pick(SYMBOLS),
    entryPriceUsd,
    sizeSol: Number(randBetween(0.08, 0.42).toFixed(3)),
    mode: rand() > 0.2 ? "dry-run" : "live",
    currentPriceUsd: entryPriceUsd * (1 + drift / 100),
    slPct: 12,
    tpPct: 35,
    openedAt: Date.now(),
  };
}

// ───────────────────────── Producer ─────────────────────────

export interface MockProducerOptions {
  /** Wall-clock start used to compute agent uptime. Defaults to now. */
  startedAt?: number;
}

/**
 * Starts publishing synthetic events to the bus. Returns a stop() function
 * that clears all timers.
 */
export function startMockProducer(
  bus: EventBus,
  opts: MockProducerOptions = {},
): () => void {
  const startedAt = opts.startedAt ?? Date.now();
  const positions: LivePosition[] = Array.from({ length: 5 }, makePosition);
  let step = 0;

  // ─── Helpers for emitting individual position events ───

  const emitOpened = (p: LivePosition): void => {
    const opened: PositionOpenedEvent = {
      id: p.id,
      mint: p.mint,
      symbol: p.symbol,
      entryPriceUsd: p.entryPriceUsd,
      sizeSol: p.sizeSol,
      mode: p.mode,
    };
    void bus.publish(CHANNELS.trading, { type: "position_opened", data: opened });
  };

  const emitClosed = (p: LivePosition, reason: string): void => {
    const pnlPct = ((p.currentPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
    const pnlSol = p.sizeSol * (pnlPct / 100);
    const closed: PositionClosedEvent = {
      id: p.id,
      pnlPct,
      pnlSol,
      closePriceUsd: p.currentPriceUsd,
      reason,
    };
    void bus.publish(CHANNELS.trading, { type: "position_closed", data: closed });
  };

  // Initial snapshot — emit all positions as opened
  for (const p of positions) emitOpened(p);

  // Periodic full snapshot so late-joining clients see current state
  const snapshotId = setInterval(() => {
    for (const p of positions) emitOpened(p);
  }, 5000);

  // Position price ticks → position_update (every 1.2s).
  const tickId = setInterval(() => {
    for (const p of positions) {
      const tick = (rand() - 0.48) * 0.018;
      p.currentPriceUsd = Math.max(p.currentPriceUsd * (1 + tick), 1e-9);
      const pnlPct = ((p.currentPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
      const update: PositionUpdateEvent = {
        id: p.id,
        currentPriceUsd: p.currentPriceUsd,
        pnlPct,
        slPct: p.slPct,
        tpPct: p.tpPct,
      };
      void bus.publish(CHANNELS.trading, { type: "position_update", data: update });
    }
  }, 1200);

  // ─── Position lifecycle — periodically close old positions & open new ones ───
  const lifecycleId = setInterval(() => {
    // Close 1-2 random positions
    const toClose = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < toClose && positions.length > 2; i++) {
      const idx = Math.floor(rand() * positions.length);
      const removed = positions.splice(idx, 1)[0];
      if (!removed) continue;
      const reasons = ["TAKE PROFIT", "STOP LOSS", "MANUAL CLOSE", "REBALANCE", "TIME EXIT"];
      emitClosed(removed, pick(reasons));
    }

    // Open 1-3 new positions to maintain ~3-8 active
    const target = 3 + Math.floor(rand() * 6);
    while (positions.length < target) {
      const fresh = makePosition();
      positions.push(fresh);
      emitOpened(fresh);
    }
  }, 10000);

  // Screening rows (every 3.2s) — raw on CHANNELS.screening.
  const screenId = setInterval(() => {
    const r = rand();
    const verdict: ScreeningVerdict = r < 0.55 ? "SAFE" : r < 0.85 ? "CAUTION" : "REJECT";
    const score =
      verdict === "SAFE"
        ? Math.floor(randBetween(5, 25))
        : verdict === "CAUTION"
          ? Math.floor(randBetween(28, 58))
          : Math.floor(randBetween(62, 95));
    const flags =
      verdict === "REJECT"
        ? Array.from({ length: 2 }, () => pick(REJECT_FLAGS))
        : Array.from({ length: 3 }, () => pick(FLAG_POOL));
    const evt: ScreeningResultEvent = {
      mint: makeBase58(),
      score,
      verdict,
      flags: Array.from(new Set(flags)),
      ts: Date.now(),
    };
    void bus.publish(CHANNELS.screening, evt);
  }, 3200);

  // Smart-wallet feed (every 1.8s) — { type, data } on CHANNELS.smartWallet.
  const walletId = setInterval(() => {
    if (rand() > 0.42) {
      const data: WalletEnteredEvent = {
        wallet: makeBase58(),
        trust: randBetween(0.5, 0.98),
        mint: makeBase58(),
        priceUsd: randBetween(0.00002, 0.012),
        ts: Date.now(),
      };
      void bus.publish(CHANNELS.smartWallet, { type: "wallet_entered", data });
    } else {
      const data: WalletExitedEvent = {
        wallet: makeBase58(),
        mint: makeBase58(),
        fraction: randBetween(0.2, 1),
        ts: Date.now(),
      };
      void bus.publish(CHANNELS.smartWallet, { type: "wallet_exited", data });
    }
  }, 1800);

  // Agent status (every 4.5s) — raw on CHANNELS.status.
  const statusId = setInterval(() => {
    const evt: AgentStatusEvent = {
      state: pick(AGENT_STATES),
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    };
    void bus.publish(CHANNELS.status, evt);
  }, 4500);

  // Reasoning steps (every 1.4s) — { type, data } on CHANNELS.reasoning.
  const reasonId = setInterval(() => {
    step += 1;
    const data: ReasoningStepEvent = {
      step,
      thought: pick(THOUGHTS).replace(/\{SYM\}/g, pick(SYMBOLS)),
      confidence: randBetween(0.35, 0.95),
      ts: Date.now(),
    };
    void bus.publish(CHANNELS.reasoning, { type: "reasoning_step", data });
  }, 1400);

  // Entry decisions (every 7.2s) — { type, data } on CHANNELS.reasoning.
  const decisionId = setInterval(() => {
    const actions: readonly TradeAction[] = ["BUY", "SELL", "HOLD", "SKIP"];
    const action = pick(actions);
    const data: EntryDecisionEvent = {
      mint: makeBase58(),
      symbol: pick(SYMBOLS),
      action,
      conviction: randBetween(0.3, 0.95),
      sizeSol: action === "BUY" ? Number(randBetween(0.08, 0.42).toFixed(3)) : undefined,
      reason: pick(DECISION_REASONS),
    };
    void bus.publish(CHANNELS.reasoning, { type: "entry_decision", data });
  }, 7200);

  return () => {
    clearInterval(snapshotId);
    clearInterval(tickId);
    clearInterval(lifecycleId);
    clearInterval(screenId);
    clearInterval(walletId);
    clearInterval(statusId);
    clearInterval(reasonId);
    clearInterval(decisionId);
  };
}
