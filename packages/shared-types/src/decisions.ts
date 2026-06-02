/** Agent decision & trade types. */

export type TradeAction = "BUY" | "SELL" | "HOLD" | "SKIP" | "SET_SL" | "SET_TP" | "EXIT";

export type ExecutionMode = "dry-run" | "live";

export type ModelTier = "flash" | "pro";

/** Raw structured output from DeepSeek's submit_trade_decision tool. */
export interface TradeDecision {
  action: TradeAction;
  token: string; // mint
  symbol?: string;
  size_sol?: number;
  confidence: number; // 0..1
  reason: string; // rationale, always present
  stop_loss_pct?: number | null;
  take_profit_pct?: number | null;
  risk_flags?: string[];
  exit_position_id?: string;
  entry_score?: number;
  expected_value_sol?: number;
  expected_cost_sol?: number;
}

/** Persisted, enriched decision record. */
export interface DecisionRecord {
  id: string;
  ts: number;
  mint: string;
  symbol?: string;
  action: TradeAction;
  sizeSol?: number;
  confidence: number;
  reason: string;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
  riskFlags: string[];
  modelUsed: ModelTier;
  inputContextHash: string;
  smartWalletsInToken: string[];
  screeningScore?: number;
  mode: ExecutionMode;
  reasoningTrace?: string;
  positionId?: string;
}

export type TradeDirection = "BUY" | "SELL";

export type TradeStatus = "PENDING" | "CONFIRMED" | "FAILED" | "SIMULATED";

export interface TradeRecord {
  id: string;
  mint: string;
  symbol?: string;
  direction: TradeDirection;
  sizeSol: number;
  priceUsd?: number;
  priceSol?: number;
  tokenAmount?: number;
  slippageBps?: number;
  feeSol?: number;
  txSignature?: string;
  route?: string;
  mode: ExecutionMode;
  status: TradeStatus;
  createdAt: number;
  confirmedAt?: number;
  metadata?: Record<string, unknown>;
}

export type PositionStatus = "OPEN" | "CLOSED";

export interface Position {
  id: string;
  mint: string;
  symbol?: string;
  entryTradeId?: string;
  exitTradeId?: string;
  sizeSol: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  pnlSol?: number;
  pnlPct?: number;
  maxDrawdownPct?: number;
  holdSeconds?: number;
  mode: ExecutionMode;
  status: PositionStatus;
  openedAt: number;
  closedAt?: number;
}

export interface SimulatedFill {
  mint: string;
  direction: TradeDirection;
  sizeSol: number;
  expectedTokenAmount: number;
  expectedPriceUsd: number;
  priceImpactPct: number;
  slippageBps: number;
}
