/** Safety screening (rug / honeypot) types. */

export type ScreeningVerdict = "SAFE" | "CAUTION" | "REJECT";

export type ScreeningPreset = "strict" | "normal" | "relaxed";

export interface ScreeningCheck {
  pass: boolean;
  value?: unknown;
  note?: string;
}

export interface ScreeningReport {
  mint: string;
  verdict: ScreeningVerdict;
  /** 0-100, lower is safer. */
  score: number;
  checks: Record<string, ScreeningCheck>;
  liquidityUsd?: number;
  pairAgeSec?: number;
  lpLockedPct?: number;
  top10Pct?: number;
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  isToken2022?: boolean;
  honeypot?: boolean;
  flags: string[];
  ts: number;
}
