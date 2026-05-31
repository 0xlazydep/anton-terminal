/**
 * Deterministic-ish synthetic candidate generator. Used as a fallback when
 * the network / DexScreener is unavailable, so the agent pipeline keeps
 * producing a realistic stream offline.
 */

import type { EnrichedCandidate, MarketContext, TokenPhase } from "@anton/shared-types";

let seed = 0x2f6e15a3;
function rand(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100_000) / 100_000;
}
function between(min: number, max: number): number {
  return min + (max - min) * rand();
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

const SYMBOLS = [
  "PEPE3", "WIFHAT", "BONK2", "MYRO", "POPCAT", "MOTHER", "GIGA", "PNUT",
  "GOAT", "CHILLGUY", "MOODENG", "FWOG", "PUNDU", "RETARDIO", "ANATOLY",
] as const;
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";

function makeMint(): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += CHARS[Math.floor(rand() * CHARS.length)];
  return s;
}

export function simulateCandidates(limit = 8): EnrichedCandidate[] {
  const out: EnrichedCandidate[] = [];
  for (let i = 0; i < limit; i++) {
    const mint = makeMint();
    const symbol = pick(SYMBOLS);
    const priceUsd = between(0.00002, 0.012);
    const ageSec = Math.floor(between(45, 60 * 60 * 4));
    const phase: TokenPhase = ageSec < 3600 ? "bonding_curve" : "graduated";
    const liquidityUsd = between(6_000, 220_000);
    const vol5m = between(2_000, 90_000);
    const change5m = between(-25, 60);

    const market: MarketContext = {
      mint,
      symbol,
      priceUsd,
      priceSol: priceUsd / 150,
      liquidityUsd,
      volume5mUsd: vol5m,
      volume24hUsd: vol5m * between(8, 40),
      pairAgeSec: ageSec,
      priceChange5mPct: change5m,
      momentum: change5m / 100,
      phase,
    };

    out.push({
      mint,
      symbol,
      name: `${symbol} (sim)`,
      source: "dexscreener_trending",
      detectedAt: Date.now(),
      phase,
      raw: { simulated: true },
      signals: { liquidityUsd, volume5mUsd: vol5m, priceUsd },
      market,
    });
  }
  return out;
}
