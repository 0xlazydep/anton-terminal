/**
 * Mock data layer — gives the dashboard a fully populated, animated demo
 * WITHOUT any backend running. Toggled via NEXT_PUBLIC_MOCK.
 *
 * All shapes conform to @anton/shared-types event/decision contracts.
 */

import type {
  AgentState,
  EntryDecisionEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
  ReasoningStepEvent,
  ScreeningResultEvent,
  WalletEnteredEvent,
  WalletExitedEvent,
} from "@anton/shared-types";

// ───────────────────────── Deterministic-ish PRNG ─────────────────────────

let seed = 1337;
function rand(): number {
  // xorshift32
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100_000) / 100_000;
}
function randBetween(min: number, max: number): number {
  return min + (max - min) * rand();
}
function pick<T>(arr: readonly T[]): T {
  const i = Math.floor(rand() * arr.length);
  return arr[i] as T;
}

const SYMBOLS = [
  "PEPE3",
  "WIFHAT",
  "BONK2",
  "MYRO",
  "POPCAT",
  "MOTHER",
  "GIGA",
  "PNUT",
  "GOAT",
  "CHILLGUY",
  "MOODENG",
  "FWOG",
  "PUNDU",
  "RETARDIO",
  "ANATOLY",
] as const;

function makeMint(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

function makeWallet(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

// ───────────────────────── Positions ─────────────────────────

export interface MockPosition extends PositionOpenedEvent {
  currentPriceUsd: number;
  currentMarketCapUsd?: number;
  pnlPct: number;
  pnlSol: number;
  slPct: number;
  tpPct: number;
  openedAt: number;
  mirroredFrom?: string;
}

const KNOWN_POSITIONS: MockPosition[] = (() => {
  const now = Date.now();
  const out: MockPosition[] = [];
  for (let i = 0; i < 5; i++) {
    const entryPriceUsd = randBetween(0.00002, 0.012);
    const driftPct = randBetween(-18, 42);
    const sizeSol = randBetween(0.08, 0.42);
    const currentPriceUsd = entryPriceUsd * (1 + driftPct / 100);
    const pnlSol = sizeSol * (driftPct / 100);
    const entryMarketCapUsd = randBetween(20_000, 400_000);
    const currentMarketCapUsd = entryMarketCapUsd * (1 + driftPct / 100);
    out.push({
      id: `pos_${i}_${Math.floor(rand() * 1e6)}`,
      mint: makeMint(),
      symbol: pick(SYMBOLS),
      entryPriceUsd,
      entryMarketCapUsd,
      sizeSol,
      mode: rand() > 0.2 ? "dry-run" : "live",
      currentPriceUsd,
      currentMarketCapUsd,
      pnlPct: driftPct,
      pnlSol,
      slPct: 12,
      tpPct: 35,
      openedAt: now - Math.floor(randBetween(30, 4200)) * 1000,
    });
  }
  return out;
})();

export function getInitialPositions(): MockPosition[] {
  return [...KNOWN_POSITIONS];
}

/**
 * Mutate prices in-place to simulate live ticks; emit PositionUpdateEvent[].
 */
export function tickPositions(
  positions: MockPosition[],
): { positions: MockPosition[]; updates: PositionUpdateEvent[] } {
  const updates: PositionUpdateEvent[] = [];
  const next = positions.map((p) => {
    const tick = (rand() - 0.48) * 0.018; // slight upward bias
    const newPrice = Math.max(p.currentPriceUsd * (1 + tick), 1e-9);
    const newMc =
      p.currentMarketCapUsd !== undefined
        ? Math.max(p.currentMarketCapUsd * (1 + tick), 1)
        : undefined;
    const pnlPct = ((newPrice - p.entryPriceUsd) / p.entryPriceUsd) * 100;
    const pnlSol = p.sizeSol * (pnlPct / 100);
    const upd: PositionUpdateEvent = {
      id: p.id,
      currentPriceUsd: newPrice,
      currentMarketCapUsd: newMc,
      pnlPct,
      slPct: p.slPct,
      tpPct: p.tpPct,
    };
    updates.push(upd);
    return { ...p, currentPriceUsd: newPrice, currentMarketCapUsd: newMc, pnlPct, pnlSol };
  });
  return { positions: next, updates };
}

// ───────────────────────── Reasoning stream ─────────────────────────

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
  "Position {SYM} SL armed at -12% · drawdown 4.2%",
  "Volume divergence on {SYM} · smart-wallet W-2b1c exited 60% · tightening SL",
  "DeepSeek pro tier engaged · deep reasoning on edge case",
  "Heartbeat OK · Helius latency 41ms · Jupiter latency 88ms",
  "Daily PnL +0.84 SOL · within loss cap · continuing entries",
  "Reflection stored: lesson L-1044 'avoid graduation +5m if vol <$15k'",
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

export function makeReasoningStep(prevStep = 0): ReasoningStepEvent {
  const symbol = pick(SYMBOLS);
  const template = pick(THOUGHTS);
  return {
    step: prevStep + 1,
    thought: template.replace(/\{SYM\}/g, symbol),
    confidence: randBetween(0.35, 0.95),
    ts: Date.now(),
  };
}

export function makeDecision(): EntryDecisionEvent {
  const actions = ["BUY", "SKIP", "HOLD", "SELL"] as const;
  const action = pick(actions);
  return {
    mint: makeMint(),
    symbol: pick(SYMBOLS),
    action,
    conviction: randBetween(0.3, 0.95),
    sizeSol:
      action === "BUY" ? Number(randBetween(0.08, 0.42).toFixed(3)) : undefined,
    reason: pick(DECISION_REASONS),
  };
}

// ───────────────────────── Screening ─────────────────────────

const FLAG_POOL = [
  "MINT_AUTH_REVOKED",
  "FREEZE_AUTH_REVOKED",
  "LP_LOCKED_82PCT",
  "TOP10_18PCT",
  "PAIR_AGE_14M",
  "VOL_5M_OK",
  "NO_HONEYPOT_SIG",
  "SMART_WALLETS_3",
] as const;

const REJECT_FLAGS = [
  "MINT_AUTH_LIVE",
  "TOP10_71PCT",
  "LOW_LIQ",
  "FREEZE_AUTH_LIVE",
] as const;

export function makeScreening(): ScreeningResultEvent {
  const r = rand();
  const verdict: ScreeningResultEvent["verdict"] =
    r < 0.55 ? "SAFE" : r < 0.85 ? "CAUTION" : "REJECT";
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
  return {
    mint: makeMint(),
    score,
    verdict,
    flags: Array.from(new Set(flags)),
    ts: Date.now(),
  };
}

export interface MockScreeningRow extends ScreeningResultEvent {
  symbol: string;
  liquidityUsd: number;
  pairAgeSec: number;
}

export function makeScreeningRow(): MockScreeningRow {
  const base = makeScreening();
  return {
    ...base,
    symbol: pick(SYMBOLS),
    ts: Date.now(),
    liquidityUsd: randBetween(8_000, 220_000),
    pairAgeSec: Math.floor(randBetween(60, 60 * 60 * 6)),
  };
}

// ───────────────────────── Smart wallets ─────────────────────────

export type SmartWalletEvent =
  | ({ kind: "entered" } & WalletEnteredEvent)
  | ({ kind: "exited" } & WalletExitedEvent);

export function makeWalletEvent(): SmartWalletEvent {
  if (rand() > 0.42) {
    return {
      kind: "entered",
      wallet: makeWallet(),
      trust: randBetween(0.5, 0.98),
      mint: makeMint(),
      priceUsd: randBetween(0.00002, 0.012),
      ts: Date.now(),
    };
  }
  return {
    kind: "exited",
    wallet: makeWallet(),
    mint: makeMint(),
    fraction: randBetween(0.2, 1),
    ts: Date.now(),
  };
}

// ───────────────────────── Candles ─────────────────────────

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export function makeInitialCandles(count = 240): Candle[] {
  const candles: Candle[] = [];
  let price = 0.0042;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count - 1; i >= 0; i--) {
    const open = price;
    const drift = (rand() - 0.49) * 0.04;
    const close = Math.max(open * (1 + drift), 1e-9);
    const high = Math.max(open, close) * (1 + rand() * 0.018);
    const low = Math.min(open, close) * (1 - rand() * 0.018);
    candles.push({
      time: now - i * 30, // 30s candles
      open,
      high,
      low,
      close,
    });
    price = close;
  }
  return candles;
}

export function nextCandle(prev: Candle): Candle {
  const time = prev.time + 30;
  const open = prev.close;
  const drift = (rand() - 0.49) * 0.05;
  const close = Math.max(open * (1 + drift), 1e-9);
  const high = Math.max(open, close) * (1 + rand() * 0.02);
  const low = Math.min(open, close) * (1 - rand() * 0.02);
  return { time, open, high, low, close };
}

// ───────────────────────── Agent status ─────────────────────────

const AGENT_STATES: AgentState[] = [
  "scanning",
  "analyzing",
  "entering",
  "watching",
  "idle",
];

export function nextAgentStatus(): { state: AgentState; uptimeSec: number } {
  return {
    state: pick(AGENT_STATES),
    uptimeSec: Math.floor(Date.now() / 1000 - 1_715_000_000),
  };
}
