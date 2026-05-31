/** Memory, identity, and learning types. */

import type { MarketContext } from "./tokens.js";
import type { TradeAction } from "./decisions.js";

export type LessonSeverity = "critical" | "important" | "note";

export type LessonSource = "trade" | "user";

export interface Lesson {
  id: string;
  createdAt: number;
  category: string; // 'entry_timing' | 'sizing' | 'exit' | 'screening' | 'smart_wallet'
  summary: string;
  severity: LessonSeverity;
  embedding?: number[];
  tradeIds: string[];
  source: LessonSource;
  retired?: boolean;
  retiredReason?: string;
}

export type OutcomeCategory =
  | "WIN_BIG"
  | "WIN_SMALL"
  | "BREAKEVEN"
  | "LOSS_SMALL"
  | "LOSS_BIG";

export interface TradeEpisode {
  id: string;
  ts: number;
  token: string; // mint
  symbol: string;
  marketSnapshot: MarketContext;
  decision: {
    action: TradeAction;
    sizeSol: number;
    reason: string;
    confidence: number;
  };
  smartWalletBasis?: SmartWalletContext;
  outcome: {
    pnlSol: number;
    pnlPct: number;
    maxDrawdownPct: number;
    slippageBps: number;
    holdSeconds: number;
    category: OutcomeCategory;
  };
}

export type RiskTolerance = "LOW" | "MEDIUM" | "HIGH" | "DEGEN";

export interface AgentIdentity {
  name: string; // "Anton"
  version: string;
  createdAt: number;
  personality: {
    tone: string;
    riskTolerance: RiskTolerance;
    preferredMarkets: string[];
    maxPositionSizeSol: number;
    maxDailyLossSol: number;
    defaultStopLossPct: number;
    defaultTakeProfitPct: number;
  };
  immutableRules: string[];
}

export interface UserProfile {
  userId: string;
  name: string;
  preferences: {
    notificationChannel: "discord" | "telegram" | "console";
    approvalRequired: boolean;
    approvalThresholdSol: number;
    riskBoundaries: {
      maxDailyLoss: number;
      maxPositionSize: number;
    };
  };
  interaction: {
    lastSeen: number;
    sessions: number;
    commands: string[];
  };
  taughtLessons: {
    id: string;
    content: string;
    ts: number;
    category: string;
  }[];
}

export interface UserFact {
  userId: string;
  content: string;
  category: string;
  ts: number;
}

// ─── Smart-wallet learning ───

export interface SmartWallet {
  address: string;
  label: string;
  winRate: number;
  realizedPnl30dUsd: number;
  avgHoldSeconds: number;
  tradeCount30d: number;
  trust: number; // 0..1
  active: boolean;
  lastEvaluated: number;
}

export type SwapSide = "BUY" | "SELL";

export interface WalletSwap {
  wallet: string;
  mint: string;
  side: SwapSide;
  solAmount: number;
  tokenAmount: number;
  priceUsd?: number;
  signature: string;
  ts: number;
}

export interface ImitationProfile {
  wallet: string;
  trust: number;
  medianTpPct: number;
  medianSlPct: number;
  scaleOut: boolean;
  medianHoldSec: number;
  recentWinRate: number;
}

export interface SmartWalletContext {
  mint: string;
  walletsIn: {
    wallet: string;
    trust: number;
    enteredAt: number;
    entryPriceUsd: number;
  }[];
  walletsExiting: {
    wallet: string;
    soldFraction: number;
    ts: number;
  }[];
  aggregate: {
    netTrustWeightedFlow: number;
    avgEntryPriceUsd: number;
    suggestedTpPct: number;
    suggestedSlPct: number;
    consensusHoldSec: number;
  };
}
