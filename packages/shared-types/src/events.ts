/** Realtime event contract (backend → dashboard) and queue names. */

import type { ExecutionMode, TradeAction } from "./decisions.js";
import type { ScreeningPreset, ScreeningVerdict } from "./screening.js";
import type { TokenSource } from "./tokens.js";

export type AgentState =
  | "scanning"
  | "analyzing"
  | "entering"
  | "watching"
  | "idle";

// ─── Trading events (Socket.IO, bidirectional) ───

export interface PositionOpenedEvent {
  id: string;
  mint: string;
  symbol?: string;
  entryPriceUsd: number;
  entryMarketCapUsd?: number;
  sizeSol: number;
  txSig?: string;
  mode: ExecutionMode;
}

export interface PositionClosedEvent {
  id: string;
  pnlSol: number;
  pnlPct: number;
  closePriceUsd: number;
  reason: string;
  txSig?: string;
}

export interface PositionUpdateEvent {
  id: string;
  currentPriceUsd: number;
  currentMarketCapUsd?: number;
  pnlPct: number;
  slPct?: number;
  tpPct?: number;
}

export interface PriceUpdateEvent {
  mint: string;
  priceUsd: number;
  priceSol: number;
  ts: number;
}

/** Per-cycle portfolio totals. Invariant: solBalance === startingSol + totalPnlSol. */
export interface HoldingsSnapshotEvent {
  startingSol: number;
  solBalance: number;
  totalPnlSol: number;
}

/** A single open position, fully hydrated for the dashboard table. */
export interface OpenPositionSnapshot {
  id: string;
  mint: string;
  symbol?: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entryMarketCapUsd?: number;
  currentMarketCapUsd?: number;
  sizeSol: number;
  pnlPct: number;
  pnlSol: number;
  slPct: number;
  tpPct: number;
  mode: ExecutionMode;
  openedAt: number;
}

/** A single closed position for the history table. */
export interface ClosedPositionSnapshot extends OpenPositionSnapshot {
  closePriceUsd: number;
  reason: string;
  closedAt: number;
}

/** One point on the persisted SOL equity curve. */
export interface BalancePointSnapshot {
  ts: number;
  solBalance: number;
}

/**
 * Full state replay emitted to a client the moment it connects (or reconnects
 * after a dashboard reload). Without this, a reloaded page stays empty because
 * the pub/sub bus has no message history.
 */
export interface StateSnapshotEvent {
  positions: OpenPositionSnapshot[];
  history: ClosedPositionSnapshot[];
  balanceHistory: BalancePointSnapshot[];
  startingSol: number;
  mode?: ExecutionMode;
}

// ─── Screening events (server → client) ───

export interface ScreeningResultEvent {
  mint: string;
  symbol?: string;
  score: number;
  verdict: ScreeningVerdict;
  flags: string[];
  liquidityUsd?: number;
  pairAgeSec?: number;
  ts: number;
  source?: TokenSource;
  llmAction?: "BUY" | "SKIP";
}

// ─── Reasoning events (SSE) ───

export interface ReasoningStepEvent {
  step: number;
  thought: string;
  confidence?: number;
  ts: number;
}

export interface EntryDecisionEvent {
  mint: string;
  symbol?: string;
  action: TradeAction;
  conviction: number;
  sizeSol?: number;
  reason: string;
}

export interface AlertEvent {
  level: "info" | "warn" | "error";
  message: string;
  ts: number;
}

// ─── Smart-wallet events (server → client) ───

export interface WalletEnteredEvent {
  wallet: string;
  trust: number;
  mint: string;
  priceUsd: number;
  ts: number;
}

export interface WalletExitedEvent {
  wallet: string;
  mint: string;
  fraction: number;
  ts: number;
}

// ─── Control events (client → server) ───

export interface SetModeEvent {
  mode: ExecutionMode;
}

export interface SetSpendLimitsEvent {
  minSol: number;
  maxSol: number;
}

export interface SetRiskConfigEvent {
  maxConcurrent: number;
  dailyLossCapSol: number;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  screeningPreset: ScreeningPreset;
}

export interface ManualEntryEvent {
  mint: string;
  sizeSol: number;
  slippageBps: number;
}

export interface AddWalletEvent {
  wallet: string;
  label?: string;
}

export interface AgentStatusEvent {
  state: AgentState;
  uptimeSec: number;
}

/** BullMQ queue names. */
export const QUEUES = {
  candidates: "anton:candidates",
  screening: "anton:screening",
  decision: "anton:decision",
  execution: "anton:execution",
  reflection: "anton:reflection",
  monitor: "anton:monitor",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Redis Pub/Sub channels for intra-service event bus. */
export const CHANNELS = {
  trading: "anton:bus:trading",
  screening: "anton:bus:screening",
  reasoning: "anton:bus:reasoning",
  smartWallet: "anton:bus:smart-wallet",
  status: "anton:bus:status",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
