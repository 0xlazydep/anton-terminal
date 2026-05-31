/**
 * DexScreener ingestion — free public API, no key required.
 * Docs: https://docs.dexscreener.com/api/reference
 *
 * We use the token-profiles + pairs endpoints to discover fresh Solana pairs
 * and enrich them with price / liquidity / volume so the agent has a real
 * MarketContext to reason over.
 */

import type {
  EnrichedCandidate,
  MarketContext,
  TokenPhase,
} from "@anton/shared-types";

const DEX_BASE = "https://api.dexscreener.com";
const FETCH_TIMEOUT_MS = 8000;

interface DexPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function phaseFromAge(ageSec: number): TokenPhase {
  if (ageSec < 0) return "unknown";
  return ageSec < 60 * 60 ? "bonding_curve" : "graduated";
}

function toCandidate(pair: DexPair): EnrichedCandidate | null {
  const mint = pair.baseToken?.address;
  if (!mint || pair.chainId !== "solana") return null;

  const priceUsd = pair.priceUsd ? Number(pair.priceUsd) : undefined;
  const priceSol = pair.priceNative ? Number(pair.priceNative) : undefined;
  const createdMs = pair.pairCreatedAt ?? 0;
  const pairAgeSec = createdMs > 0 ? Math.floor((Date.now() - createdMs) / 1000) : -1;
  const phase = phaseFromAge(pairAgeSec);

  const market: MarketContext = {
    mint,
    symbol: pair.baseToken?.symbol,
    priceUsd,
    priceSol,
    liquidityUsd: pair.liquidity?.usd,
    volume5mUsd: pair.volume?.m5,
    volume24hUsd: pair.volume?.h24,
    marketCapUsd: pair.marketCap,
    fdvUsd: pair.fdv,
    pairAgeSec: pairAgeSec >= 0 ? pairAgeSec : undefined,
    priceChange5mPct: pair.priceChange?.m5,
    priceChange1hPct: pair.priceChange?.h1,
    momentum: pair.priceChange?.m5 !== undefined ? pair.priceChange.m5 / 100 : undefined,
    phase,
  };

  return {
    mint,
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    source: "dexscreener_trending",
    detectedAt: Date.now(),
    phase,
    raw: pair as unknown as Record<string, unknown>,
    signals: {
      liquidityUsd: pair.liquidity?.usd,
      volume5mUsd: pair.volume?.m5,
      priceUsd,
      priceSol,
    },
    market,
    poolPubkey: pair.pairAddress,
  };
}

/**
 * Discover boosted / trending Solana tokens, then resolve each to its top
 * pair for full market data. Returns at most `limit` enriched candidates.
 * Throws on network failure (caller decides fallback).
 */
export async function fetchDexScreenerCandidates(limit = 12): Promise<EnrichedCandidate[]> {
  const boosts = await fetchJson<Array<{ chainId?: string; tokenAddress?: string }>>(
    `${DEX_BASE}/token-boosts/latest/v1`,
  );
  const solMints = boosts
    .filter((b) => b.chainId === "solana" && b.tokenAddress)
    .map((b) => b.tokenAddress as string)
    .slice(0, limit);

  if (solMints.length === 0) return [];

  const joined = solMints.join(",");
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${DEX_BASE}/latest/dex/tokens/${joined}`,
  );
  const pairs = data.pairs ?? [];

  const byMint = new Map<string, EnrichedCandidate>();
  for (const pair of pairs) {
    const cand = toCandidate(pair);
    if (!cand) continue;
    const existing = byMint.get(cand.mint);
    const existingLiq = existing?.market.liquidityUsd ?? 0;
    const candLiq = cand.market.liquidityUsd ?? 0;
    if (!existing || candLiq > existingLiq) byMint.set(cand.mint, cand);
  }
  return [...byMint.values()].slice(0, limit);
}

/** Live market snapshot for a single mint, used to poll open positions. */
export interface TokenMarketSnapshot {
  mint: string;
  priceUsd?: number;
  priceSol?: number;
  /** Market cap in USD. Prefer `marketCap`; fall back to FDV when absent. */
  marketCapUsd?: number;
  liquidityUsd?: number;
  ts: number;
}

/**
 * Fetch the current market snapshot for one mint via the free, key-less
 * `GET /latest/dex/tokens/{mint}` endpoint. Resolves the token's highest-
 * liquidity Solana pair (the price a scalper actually trades against).
 *
 * Throws on network failure or when the token has no usable Solana pair — the
 * caller (PositionBook) holds the last known price rather than inventing one.
 */
export async function fetchTokenMarket(mint: string): Promise<TokenMarketSnapshot> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${DEX_BASE}/latest/dex/tokens/${mint}`,
  );
  const solPairs = (data.pairs ?? []).filter((p) => p.chainId === "solana");
  if (solPairs.length === 0) throw new Error(`no solana pair for ${mint}`);

  // Pick the deepest pool — that is the price meme-coin scalpers exit into.
  const best = solPairs.reduce((a, b) =>
    (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
  );

  return {
    mint,
    priceUsd: best.priceUsd ? Number(best.priceUsd) : undefined,
    priceSol: best.priceNative ? Number(best.priceNative) : undefined,
    marketCapUsd: best.marketCap ?? best.fdv,
    liquidityUsd: best.liquidity?.usd,
    ts: Date.now(),
  };
}
