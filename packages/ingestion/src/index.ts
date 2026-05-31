import type { EnrichedCandidate } from "@anton/shared-types";
import { fetchDexScreenerCandidates } from "./dexscreener.js";
import { fetchPumpFunGraduatedCandidates } from "./pumpfun-graduated.js";
import { fetchPumpFunNewCandidates } from "./pumpfun-new.js";
import { fetchAxiomTrendingCandidates } from "./axiom-trending.js";
import { simulateCandidates } from "./simulator.js";

export { fetchDexScreenerCandidates, fetchTokenMarket } from "./dexscreener.js";
export type { TokenMarketSnapshot } from "./dexscreener.js";
export { fetchPumpFunGraduatedCandidates } from "./pumpfun-graduated.js";
export { fetchPumpFunNewCandidates } from "./pumpfun-new.js";
export { fetchAxiomTrendingCandidates } from "./axiom-trending.js";
export { simulateCandidates } from "./simulator.js";

export type IngestionSourceLabel =
  | "dexscreener"
  | "pumpfun_graduated"
  | "pumpfun_new"
  | "axiom"
  | "simulator"
  | "multi";

const SOURCE_BATCH_ORDER: IngestionSourceLabel[] = [
  "dexscreener",
  "pumpfun_graduated",
  "pumpfun_new",
  "axiom",
];

export interface IngestionResult {
  candidates: EnrichedCandidate[];
  source: IngestionSourceLabel;
}

function mergeAndDedup(
  batches: EnrichedCandidate[][],
  limit: number,
): EnrichedCandidate[] {
  const byMint = new Map<string, EnrichedCandidate>();
  for (const batch of batches) {
    for (const cand of batch) {
      const existing = byMint.get(cand.mint);
      const existingLiq = existing?.market.liquidityUsd ?? 0;
      const candLiq = cand.market.liquidityUsd ?? 0;
      if (!existing || candLiq > existingLiq) byMint.set(cand.mint, cand);
    }
  }
  return [...byMint.values()].slice(0, limit);
}

export async function fetchCandidates(limit = 12): Promise<IngestionResult> {
  const perSource = Math.max(4, Math.ceil(limit / 4));

  const results = await Promise.allSettled([
    fetchDexScreenerCandidates(perSource),
    fetchPumpFunGraduatedCandidates(perSource),
    fetchPumpFunNewCandidates(perSource),
    fetchAxiomTrendingCandidates("1h", perSource),
  ]);

  const batches: EnrichedCandidate[][] = [];
  let activeLabel: IngestionSourceLabel = "simulator";

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status !== "fulfilled") continue;
    const v: EnrichedCandidate[] = r.value;
    if (v.length === 0) continue;
    batches.push(v);
    if (activeLabel === "simulator") {
      activeLabel = SOURCE_BATCH_ORDER[i] ?? "simulator";
    }
  }

  if (batches.length === 0) {
    return {
      candidates: simulateCandidates(Math.min(limit, 8)),
      source: "simulator",
    };
  }

  if (batches.length === 1) {
    const merged = mergeAndDedup(batches, limit);
    return { candidates: merged, source: activeLabel };
  }

  const merged = mergeAndDedup(batches, limit);
  return { candidates: merged, source: "multi" };
}
