/**
 * Pump.fun graduated coins — free public API (unofficial), no key required
 * in practice. Discovers tokens that completed the bonding curve and migrated
 * to Raydium.
 *
 * Endpoint: GET https://advanced-api-v2.pump.fun/coins/graduated
 */

import type {
  EnrichedCandidate,
  MarketContext,
} from "@anton/shared-types";

const BASE = "https://advanced-api-v2.pump.fun";
const FETCH_TIMEOUT_MS = 8000;

interface PumpGraduatedCoin {
  coinMint?: string;
  name?: string;
  symbol?: string;
  graduationDate?: number;
  marketCap?: number;
  raydiumPool?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "anton-terminal/1.0",
      },
    });
    if (!res.ok) throw new Error(`pumpfun-graduated ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toCandidate(coin: PumpGraduatedCoin): EnrichedCandidate | null {
  const mint = coin.coinMint;
  if (!mint) return null;

  const market: MarketContext = {
    mint,
    symbol: coin.symbol,
    marketCapUsd: coin.marketCap,
    pairAgeSec: coin.graduationDate
      ? Math.floor((Date.now() - coin.graduationDate) / 1000)
      : undefined,
    phase: "graduated",
  };

  return {
    mint,
    symbol: coin.symbol || coin.name,
    name: coin.name,
    source: "pumpfun_migration",
    detectedAt: Date.now(),
    phase: "graduated",
    raw: coin as unknown as Record<string, unknown>,
    signals: {
      liquidityUsd: undefined,
      volume5mUsd: undefined,
      priceUsd: undefined,
      priceSol: undefined,
    },
    market,
    poolPubkey: coin.raydiumPool,
  };
}

export async function fetchPumpFunGraduatedCandidates(
  limit = 10,
): Promise<EnrichedCandidate[]> {
  const data = await fetchJson<{ coins?: PumpGraduatedCoin[] }>(
    `${BASE}/coins/graduated`,
  );
  const coins = Array.isArray(data.coins) ? data.coins : [];
  const byMint = new Map<string, EnrichedCandidate>();
  for (const coin of coins) {
    const cand = toCandidate(coin);
    if (!cand) continue;
    const existing = byMint.get(cand.mint);
    const existingMC = existing?.market.marketCapUsd ?? 0;
    const candMC = cand.market.marketCapUsd ?? 0;
    if (!existing || candMC > existingMC) byMint.set(cand.mint, cand);
  }
  return [...byMint.values()].slice(0, limit);
}
