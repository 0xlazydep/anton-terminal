/**
 * RugCheck.xyz public API client. The summary endpoint is free and keyless.
 * Docs: https://api.rugcheck.xyz/swagger/index.html
 *
 * Returns null on any failure so the caller can fall back to on-chain +
 * heuristic screening.
 */

export interface RugCheckSummary {
  /** RugCheck's own risk score (higher = riskier). */
  score: number;
  rugged: boolean;
  topHolderPct?: number;
  risks: string[];
}

const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1";
const FETCH_TIMEOUT_MS = 8000;

interface RugCheckRaw {
  score?: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: Array<{ name?: string; level?: string }>;
  topHolders?: Array<{ pct?: number }>;
}

export async function fetchRugCheck(mint: string): Promise<RugCheckSummary | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${RUGCHECK_BASE}/tokens/${mint}/report/summary`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RugCheckRaw;
    const topHolderPct = raw.topHolders?.reduce((sum, h) => sum + (h.pct ?? 0), 0);
    return {
      score: raw.score_normalised ?? raw.score ?? 0,
      rugged: raw.rugged ?? false,
      topHolderPct,
      risks: (raw.risks ?? []).map((r) => r.name ?? "").filter(Boolean),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
