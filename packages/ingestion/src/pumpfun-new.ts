/**
 * Pump.fun new tokens — currently-live endpoint, returns pre-graduation tokens
 * on the bonding curve. JWT Bearer token is documented as required but often
 * works with browser headers in practice.
 *
 * Endpoint: GET https://frontend-api-v3.pump.fun/coins/currently-live
 */

import type {
  EnrichedCandidate,
  MarketContext,
} from "@anton/shared-types";

const BASE = "https://frontend-api-v3.pump.fun";
const FETCH_TIMEOUT_MS = 8000;

interface PumpLiveCoin {
  mint?: string;
  name?: string;
  symbol?: string;
  created_timestamp?: number;
  usd_market_cap?: number;
  market_cap?: number;
  complete?: boolean;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  total_supply?: number;
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "anton-terminal/1.0",
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`pumpfun-new ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toCandidate(coin: PumpLiveCoin): EnrichedCandidate | null {
  const mint = coin.mint;
  if (!mint) return null;

  const ageSec = coin.created_timestamp
    ? Math.floor((Date.now() - coin.created_timestamp) / 1000)
    : -1;
  const phase = coin.complete ? "graduated" : "bonding_curve";

  const market: MarketContext = {
    mint,
    symbol: coin.symbol,
    marketCapUsd: coin.usd_market_cap,
    pairAgeSec: ageSec >= 0 ? ageSec : undefined,
    fdvUsd: undefined,
    phase,
  };

  return {
    mint,
    symbol: coin.symbol,
    name: coin.name,
    source: "pumpfun_new",
    detectedAt: Date.now(),
    phase,
    raw: coin as unknown as Record<string, unknown>,
    signals: {
      liquidityUsd: undefined,
      volume5mUsd: undefined,
      priceUsd: undefined,
      priceSol: undefined,
    },
    market,
  };
}

export async function fetchPumpFunNewCandidates(
  limit = 10,
): Promise<EnrichedCandidate[]> {
  const data = await fetchJson<unknown>(
    `${BASE}/coins/currently-live?limit=${limit}&offset=0&includeNsfw=false&order=DESC`,
  );
  // response wrapper is inconsistent: may be array directly or { coins: [...] }
  const coins: PumpLiveCoin[] = Array.isArray(data)
    ? data
    : (data as { coins?: PumpLiveCoin[] }).coins ?? [];
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
