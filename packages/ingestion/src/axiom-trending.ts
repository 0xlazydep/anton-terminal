/**
 * Axiom Trade trending tokens — unofficial API, uses positional array-of-arrays
 * raw response. Browser headers are required; authenticated tokens improve
 * reliability but anonymous access works for many time periods.
 *
 * Endpoint: GET https://api8.axiom.trade/new-trending-v2?timePeriod=1h&v={ts}
 *
 * The raw response is a positional array where:
 *   [1] = mint, [2] = name, [3] = symbol, [7] = platform,
 *   [9] = createdAt (unix ms), [18] = totalSupply, [22] = holderCount,
 *   [23] = volume, [29] = price (USD)
 *
 * This mapping is fragile (indices may shift). The source is fail-safe: any
 * parse error silently returns an empty array so the pipeline falls through
 * to other sources.
 */

import type {
  EnrichedCandidate,
  MarketContext,
} from "@anton/shared-types";

const BASE = "https://api8.axiom.trade";
const FETCH_TIMEOUT_MS = 8000;

type AxiomRow = unknown[];

// --- positional index constants (documented above) ---
const IDX_MINT = 1;
const IDX_NAME = 2;
const IDX_SYMBOL = 3;
const IDX_PLATFORM = 7;
const IDX_CREATED_AT = 9;
const IDX_TOTAL_SUPPLY = 18;
const IDX_HOLDER_COUNT = 22;
const IDX_VOLUME = 23;
const IDX_PRICE = 29;

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        origin: "https://axiom.trade",
        referer: "https://axiom.trade/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) throw new Error(`axiom ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toCandidate(row: AxiomRow): EnrichedCandidate | null {
  try {
    const mint = row[IDX_MINT];
    if (typeof mint !== "string" || mint.length < 32) return null;

    const name = typeof row[IDX_NAME] === "string" ? row[IDX_NAME] : undefined;
    const symbol =
      typeof row[IDX_SYMBOL] === "string" ? row[IDX_SYMBOL] : undefined;
    const platform =
      typeof row[IDX_PLATFORM] === "string" ? row[IDX_PLATFORM] : undefined;
    const createdAt = Number(row[IDX_CREATED_AT] ?? 0);
    const holderCount = Number(row[IDX_HOLDER_COUNT] ?? 0) || undefined;
    const volume = Number(row[IDX_VOLUME] ?? 0) || undefined;
    const priceUsd = Number(row[IDX_PRICE] ?? 0) || undefined;

    const pairAgeSec =
      createdAt > 0 ? Math.floor((Date.now() - createdAt) / 1000) : -1;
    const phase =
      platform === "raydium"
        ? "graduated"
        : pairAgeSec > 0 && pairAgeSec < 3600
          ? "bonding_curve"
          : "unknown";

    const market: MarketContext = {
      mint,
      symbol,
      priceUsd,
      pairAgeSec: pairAgeSec >= 0 ? pairAgeSec : undefined,
      volume5mUsd: undefined,
      volume24hUsd: undefined,
      marketCapUsd: undefined,
      fdvUsd: undefined,
      holderCount,
      phase,
    };

    return {
      mint,
      symbol,
      name,
      source: "axiom_trending",
      detectedAt: Date.now(),
      phase,
      raw: row as unknown as Record<string, unknown>,
      signals: {
        liquidityUsd: undefined,
        volume5mUsd: volume,
        priceUsd,
        priceSol: undefined,
      },
      market,
    };
  } catch {
    return null; // any parse error on a row → skip it silently
  }
}

export async function fetchAxiomTrendingCandidates(
  timePeriod: "1h" | "6h" | "24h" = "1h",
  limit = 10,
): Promise<EnrichedCandidate[]> {
  const v = Date.now();
  const data = await fetchJson<AxiomRow[]>(
    `${BASE}/new-trending-v2?timePeriod=${timePeriod}&v=${v}`,
  );
  const rows = Array.isArray(data) ? data : [];
  const byMint = new Map<string, EnrichedCandidate>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cand = toCandidate(row);
    if (!cand) continue;
    // first candidate for a mint wins (closest to trending order)
    if (!byMint.has(cand.mint)) byMint.set(cand.mint, cand);
  }
  return [...byMint.values()].slice(0, limit);
}
