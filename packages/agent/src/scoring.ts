import type { EnrichedCandidate, ScreeningReport } from "@anton/shared-types";
import type { TradingConfig } from "@anton/config";

export interface PatternStat {
  category: string;
  key: string;
  totalTrades: number;
  winRate: number | null;
  avgPnlPct: number;
}

export interface EntryScoreComponent {
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface EntryScore {
  score: number;
  components: EntryScoreComponent[];
}

const SCREENING_MAX = 25;
const MOMENTUM_MAX = 25;
const LIQUIDITY_MAX = 15;
const VOLUME_MAX = 15;
const HOLDER_MAX = 10;
const SMART_MAX = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function lerpPoints(value: number, lo: number, hi: number, max: number): number {
  if (hi <= lo) return value >= hi ? max : 0;
  return clamp(((value - lo) / (hi - lo)) * max, 0, max);
}

export function entryQualityScore(
  candidate: EnrichedCandidate,
  screening: ScreeningReport,
  patternStats: PatternStat[] = [],
): EntryScore {
  const m = candidate.market;
  const components: EntryScoreComponent[] = [];

  const verdictPoints =
    screening.verdict === "SAFE" ? SCREENING_MAX : screening.verdict === "CAUTION" ? SCREENING_MAX * 0.4 : 0;
  components.push({
    label: "screening",
    points: verdictPoints,
    max: SCREENING_MAX,
    note: `${screening.verdict} (risk score ${screening.score})`,
  });

  const momentum = m.momentum ?? 0;
  const momentumPoints = momentum <= 0 ? 0 : lerpPoints(momentum, 0.02, 0.2, MOMENTUM_MAX);
  components.push({
    label: "momentum",
    points: momentumPoints,
    max: MOMENTUM_MAX,
    note: `${(momentum * 100).toFixed(1)}% 5m`,
  });

  const liq = m.liquidityUsd ?? 0;
  const liquidityPoints = lerpPoints(liq, 1_000, 25_000, LIQUIDITY_MAX);
  components.push({
    label: "liquidity",
    points: liquidityPoints,
    max: LIQUIDITY_MAX,
    note: `$${Math.round(liq).toLocaleString()}`,
  });

  const vol = m.volume5mUsd ?? 0;
  const volumePoints = lerpPoints(vol, 500, 10_000, VOLUME_MAX);
  components.push({
    label: "volume5m",
    points: volumePoints,
    max: VOLUME_MAX,
    note: `$${Math.round(vol).toLocaleString()}`,
  });

  const top10 = screening.top10Pct;
  const holderPoints = top10 === undefined ? HOLDER_MAX * 0.5 : lerpPoints(80 - top10, 0, 60, HOLDER_MAX);
  components.push({
    label: "holders",
    points: holderPoints,
    max: HOLDER_MAX,
    note: top10 === undefined ? "unknown" : `top10 ${top10.toFixed(0)}%`,
  });

  const smartCount = candidate.signals.smartWallets?.length ?? 0;
  const smartPoints = smartCount === 0 ? 0 : lerpPoints(smartCount, 1, 4, SMART_MAX);
  components.push({
    label: "smartWallets",
    points: smartPoints,
    max: SMART_MAX,
    note: smartCount === 0 ? "none/unavailable" : `${smartCount} detected`,
  });

  let score = components.reduce((sum, c) => sum + c.points, 0);

  const mult = patternWinRateMultiplier(candidate, patternStats);
  if (mult.applied) {
    const before = score;
    score = clamp(score * mult.multiplier, 0, 100);
    components.push({
      label: "patternHistory",
      points: score - before,
      max: 0,
      note: mult.note,
    });
  }

  return { score: Math.round(clamp(score, 0, 100)), components };
}

interface WinRateMultiplier {
  applied: boolean;
  multiplier: number;
  note: string;
}

function patternWinRateMultiplier(
  candidate: EnrichedCandidate,
  patternStats: PatternStat[],
): WinRateMultiplier {
  if (patternStats.length === 0) return { applied: false, multiplier: 1, note: "" };

  const keys = relevantPatternKeys(candidate);
  const matches = patternStats.filter(
    (p) => p.totalTrades >= 3 && p.winRate !== null && keys.some((k) => k.category === p.category && k.key === p.key),
  );
  if (matches.length === 0) return { applied: false, multiplier: 1, note: "" };

  const weightedWinRate =
    matches.reduce((sum, p) => sum + (p.winRate ?? 0) * p.totalTrades, 0) /
    matches.reduce((sum, p) => sum + p.totalTrades, 0);

  const multiplier = clamp(0.6 + weightedWinRate * 0.8, 0.6, 1.3);
  return {
    applied: true,
    multiplier,
    note: `${(weightedWinRate * 100).toFixed(0)}% WR over ${matches.reduce((s, p) => s + p.totalTrades, 0)} trades → x${multiplier.toFixed(2)}`,
  };
}

function relevantPatternKeys(candidate: EnrichedCandidate): Array<{ category: string; key: string }> {
  const keys: Array<{ category: string; key: string }> = [];
  if (candidate.source) keys.push({ category: "source", key: candidate.source });
  if (candidate.phase) keys.push({ category: "phase", key: candidate.phase });

  const mc = candidate.market.marketCapUsd;
  if (mc !== undefined) {
    if (mc < 50_000) keys.push({ category: "mc_range", key: "micro" });
    else if (mc < 200_000) keys.push({ category: "mc_range", key: "small" });
    else if (mc < 1_000_000) keys.push({ category: "mc_range", key: "mid" });
    else keys.push({ category: "mc_range", key: "large" });
  }

  const liq = candidate.market.liquidityUsd;
  if (liq !== undefined) {
    if (liq < 3_000) keys.push({ category: "liquidity", key: "low" });
    else if (liq < 15_000) keys.push({ category: "liquidity", key: "medium" });
    else keys.push({ category: "liquidity", key: "high" });
  }

  return keys;
}

export interface SizeInputs {
  config: TradingConfig;
  conviction: number;
  entryScore: number;
  candidate: EnrichedCandidate;
  remainingBudgetSol?: number;
  realizedPnlSol?: number;
  rawRequestedSize?: number;
  /** Balance-derived ceiling. When set, size is clamped to this instead of config.maxSpendSol. */
  maxSizeOverride?: number;
}

export interface SizeResult {
  sizeSol: number;
  factors: { label: string; multiplier: number; note: string }[];
}

export function riskAdjustedSize(inputs: SizeInputs): SizeResult {
  const { config, conviction, entryScore, candidate } = inputs;
  const factors: { label: string; multiplier: number; note: string }[] = [];

  const base = config.minSpendSol + (config.maxSpendSol - config.minSpendSol) * clamp(conviction, 0, 1);

  const scoreMul = clamp(0.4 + (entryScore / 100) * 0.9, 0.4, 1.3);
  factors.push({ label: "entryScore", multiplier: scoreMul, note: `score ${entryScore}/100` });

  const liq = candidate.market.liquidityUsd ?? 0;
  const liqMul = liq <= 0 ? 0.5 : clamp(lerpPoints(liq, 2_000, 20_000, 1) * 0.5 + 0.5, 0.5, 1.0);
  factors.push({ label: "liquidity", multiplier: liqMul, note: `$${Math.round(liq).toLocaleString()} slippage risk` });

  const swing = Math.abs(candidate.market.priceChange5mPct ?? (candidate.market.momentum ?? 0) * 100);
  const volMul = swing <= 20 ? 1.0 : clamp(1.0 - (swing - 20) / 120, 0.6, 1.0);
  factors.push({ label: "volatility", multiplier: volMul, note: `${swing.toFixed(0)}% 5m swing` });

  let lossMul = 1.0;
  let lossNote = "no drawdown";
  if (inputs.realizedPnlSol !== undefined && inputs.realizedPnlSol < 0) {
    const cap = config.maxDailyLossSol > 0 ? config.maxDailyLossSol : 1;
    const drawdownRatio = clamp(-inputs.realizedPnlSol / cap, 0, 1);
    lossMul = clamp(1.0 - drawdownRatio * 0.6, 0.4, 1.0);
    lossNote = `down ${(-inputs.realizedPnlSol).toFixed(3)}/${cap} SOL today`;
  }
  factors.push({ label: "dailyLoss", multiplier: lossMul, note: lossNote });

  let size = base * scoreMul * liqMul * volMul * lossMul;

  if (inputs.remainingBudgetSol !== undefined && inputs.remainingBudgetSol > 0) {
    const budgetCap = inputs.remainingBudgetSol * 0.25;
    if (size > budgetCap) {
      factors.push({ label: "budgetCap", multiplier: budgetCap / size, note: `25% of ${inputs.remainingBudgetSol.toFixed(3)} SOL` });
      size = budgetCap;
    }
  }

  const ceiling = inputs.maxSizeOverride !== undefined
    ? Math.min(inputs.maxSizeOverride, config.maxSpendSol)
    : config.maxSpendSol;
  if (inputs.maxSizeOverride !== undefined && size > ceiling) {
    factors.push({ label: "balanceCap", multiplier: ceiling / size, note: `balance ceiling ${ceiling.toFixed(3)} SOL` });
  }

  const floor = Math.min(config.minSpendSol, ceiling);
  size = clamp(size, floor, ceiling);
  return { sizeSol: Math.round(size * 1000) / 1000, factors };
}

export interface FeeContext {
  avgFeePerTradeSol: number;
  totalFeeSol: number;
  tradeCount: number;
  totalPnlSol: number;
}

export interface EfficiencyGate {
  allow: boolean;
  minEntryScore: number;
  minConviction: number;
  reason: string;
  feeToProfitRatio: number;
  /** Maximum positions allowed given account balance. */
  maxConcurrent: number;
  /** Adjusted floor for minimum size given balance. */
  adjustedMinSizeSol: number;
  /** Adjusted ceiling for maximum size given balance. */
  adjustedMaxSizeSol: number;
}

export function feeEfficiencyGate(
  accountBalanceSol: number,
  feeCtx: FeeContext,
  config: TradingConfig,
): EfficiencyGate {
  const feeToProfitRatio =
    Math.abs(feeCtx.totalPnlSol) > 0.001
      ? feeCtx.totalFeeSol / Math.abs(feeCtx.totalPnlSol)
      : 0;

  const maxConcurrent = balanceScaledConcurrency(accountBalanceSol, config);
  const adjustedMin = config.minSpendSol;
  const adjustedMax = balanceCappedMax(accountBalanceSol, config);

  if (accountBalanceSol >= 5) {
    return {
      allow: true, minEntryScore: 0, minConviction: 0, reason: "sufficient capital",
      feeToProfitRatio, maxConcurrent, adjustedMinSizeSol: adjustedMin, adjustedMaxSizeSol: adjustedMax,
    };
  }

  if (accountBalanceSol <= 1) {
    const minEdge = minRequiredEdgePct(feeCtx.avgFeePerTradeSol, config.minSpendSol);
    return {
      allow: true,
      minEntryScore: 70,
      minConviction: 0.8,
      reason: `micro account (${accountBalanceSol.toFixed(2)} SOL) — need strong edge >${minEdge.toFixed(0)}% move to outrun fees. Max 1 position.`,
      feeToProfitRatio, maxConcurrent, adjustedMinSizeSol: adjustedMin, adjustedMaxSizeSol: adjustedMax,
    };
  }

  const feeRatioThreshold = accountBalanceSol <= 3 ? 0.35 : 0.5;

  if (feeCtx.tradeCount >= 3 && feeToProfitRatio >= feeRatioThreshold) {
    const minEdge = minRequiredEdgePct(feeCtx.avgFeePerTradeSol, adjustedMin);
    return {
      allow: true,
      minEntryScore: feeToProfitRatio >= 0.6 ? 65 : 50,
      minConviction: feeToProfitRatio >= 0.6 ? 0.75 : 0.65,
      reason: `fees at ${(feeToProfitRatio * 100).toFixed(0)}% of returns (${feeCtx.avgFeePerTradeSol.toFixed(3)} SOL/trade) — need >${minEdge.toFixed(0)}% move. Max ${maxConcurrent} positions.`,
      feeToProfitRatio, maxConcurrent, adjustedMinSizeSol: adjustedMin, adjustedMaxSizeSol: adjustedMax,
    };
  }

  return {
    allow: true, minEntryScore: 30, minConviction: 0.55, reason: "fees under control",
    feeToProfitRatio, maxConcurrent, adjustedMinSizeSol: adjustedMin, adjustedMaxSizeSol: adjustedMax,
  };
}

function balanceScaledConcurrency(balance: number, config: TradingConfig): number {
  if (balance <= 1) return 1;
  if (balance <= 2) return Math.min(2, config.maxConcurrentPositions);
  if (balance <= 5) return Math.min(Math.ceil(balance / 2), config.maxConcurrentPositions);
  return config.maxConcurrentPositions;
}

function balanceCappedMax(balance: number, config: TradingConfig): number {
  if (balance <= 1) return Math.min(0.08, config.maxSpendSol);
  if (balance <= 2) return Math.min(0.12, config.maxSpendSol);
  if (balance <= 5) return Math.min(balance * 0.06, config.maxSpendSol);
  return config.maxSpendSol;
}

function minRequiredEdgePct(avgFeeSol: number, minSizeSol: number): number {
  const estTotalFee = avgFeeSol * 2;
  if (minSizeSol <= 0) return 10;
  return Math.ceil((estTotalFee / minSizeSol) * 100) + 2;
}

export interface ExpectedValueInputs {
  sizeSol: number;
  takeProfitPct: number;
  stopLossPct: number;
  winProbability: number;
  avgFeePerTradeSol: number;
  avgSlippageBps: number;
}

export interface ExpectedValueResult {
  pass: boolean;
  expectedValueSol: number;
  expectedProfitSol: number;
  expectedCostSol: number;
  reason: string;
}

export function expectedValueGate(inputs: ExpectedValueInputs): ExpectedValueResult {
  const { sizeSol, takeProfitPct, stopLossPct, winProbability } = inputs;
  const p = clamp(winProbability, 0, 1);

  const winGross = sizeSol * (takeProfitPct / 100);
  const lossGross = sizeSol * (Math.abs(stopLossPct) / 100);
  const expectedGross = p * winGross - (1 - p) * lossGross;

  const roundTripFee = inputs.avgFeePerTradeSol * 2;
  const slippageCost = sizeSol * (inputs.avgSlippageBps / 10_000) * 2;
  const expectedCostSol = roundTripFee + slippageCost;

  const expectedValueSol = expectedGross - expectedCostSol;
  const pass = expectedValueSol > 0;

  return {
    pass,
    expectedValueSol,
    expectedProfitSol: expectedGross,
    expectedCostSol,
    reason: pass
      ? `EV +${expectedValueSol.toFixed(4)} SOL (gross ${expectedGross.toFixed(4)} − cost ${expectedCostSol.toFixed(4)}, p=${(p * 100).toFixed(0)}%)`
      : `EV ${expectedValueSol.toFixed(4)} SOL ≤ 0 — expected cost ${expectedCostSol.toFixed(4)} exceeds edge (gross ${expectedGross.toFixed(4)}, p=${(p * 100).toFixed(0)}%)`,
  };
}

export function winProbabilityFor(
  candidate: EnrichedCandidate,
  patternStats: PatternStat[] = [],
  conviction = 0.5,
): number {
  const mult = patternWinRateMultiplier(candidate, patternStats);
  if (mult.applied) {
    const keys = relevantPatternKeys(candidate);
    const matches = patternStats.filter(
      (s) => s.totalTrades >= 3 && s.winRate !== null && keys.some((k) => k.category === s.category && k.key === s.key),
    );
    const weighted =
      matches.reduce((sum, s) => sum + (s.winRate ?? 0) * s.totalTrades, 0) /
      matches.reduce((sum, s) => sum + s.totalTrades, 0);
    return clamp(weighted * 0.6 + conviction * 0.4, 0.05, 0.95);
  }
  return clamp(conviction, 0.05, 0.95);
}
