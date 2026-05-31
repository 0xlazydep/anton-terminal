/** Token discovery & market context types. */

export type TokenSource =
  | "pumpfun_new"
  | "pumpfun_migration"
  | "jupiter_trending"
  | "dexscreener_trending"
  | "axiom_trending"
  | "social_trending"
  | "smart_wallet"
  | "manual";

export type TokenPhase = "bonding_curve" | "graduated" | "unknown";

/** A raw candidate emitted by an ingestion source. Deduped by mint. */
export interface TokenCandidate {
  mint: string;
  symbol?: string;
  name?: string;
  source: TokenSource;
  detectedAt: number; // unix ms
  phase: TokenPhase;
  raw: Record<string, unknown>;
  signals: CandidateSignals;
}

export interface CandidateSignals {
  liquidityUsd?: number;
  volume5mUsd?: number;
  priceUsd?: number;
  priceSol?: number;
  socialMentions?: number;
  smartWallets?: string[];
}

/** Market snapshot used by the agent and stored in episodes. */
export interface MarketContext {
  mint: string;
  symbol?: string;
  priceUsd?: number;
  priceSol?: number;
  liquidityUsd?: number;
  volume5mUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  holderCount?: number;
  pairAgeSec?: number;
  /** Simple momentum signal, e.g. -1..1 or % change. */
  momentum?: number;
  priceChange5mPct?: number;
  priceChange1hPct?: number;
  phase: TokenPhase;
}

/** A candidate after price/liquidity enrichment, ready for screening/decision. */
export interface EnrichedCandidate extends TokenCandidate {
  market: MarketContext;
  poolPubkey?: string;
}

export interface SocialSignal {
  mint: string;
  mentions5m: number;
  velocityZScore: number;
  uniqueAuthors: number;
  influencerWeight: number;
  galaxyScore?: number;
  sentiment?: number;
}
