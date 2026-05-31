/**
 * Layered screening pipeline. Combines:
 *   1. On-chain mint/freeze authority (via RPC) — hard rug signal
 *   2. RugCheck.xyz summary (free API) — holder concentration + known risks
 *   3. Liquidity / pair-age heuristics from the candidate's market context
 *
 * Produces a 0-100 risk score (lower = safer) and a SAFE/CAUTION/REJECT
 * verdict. When RPC / RugCheck are unavailable it degrades to the heuristic
 * layer alone so screening never blocks the pipeline.
 */

import { Connection } from "@solana/web3.js";
import { createConnection } from "@anton/solana";
import { getScreeningPreset } from "@anton/config";
import type {
  EnrichedCandidate,
  ScreeningPreset,
  ScreeningReport,
  ScreeningVerdict,
  ScreeningCheck,
} from "@anton/shared-types";
import { checkMintAuthorities } from "./onchain.js";
import { fetchRugCheck } from "./rugcheck.js";

export interface ScreeningOptions {
  rpcUrl?: string;
  preset?: ScreeningPreset;
  /** Skip network calls (RPC + RugCheck) and use heuristics only. */
  offline?: boolean;
}

function verdictFromScore(score: number): ScreeningVerdict {
  if (score < 28) return "SAFE";
  if (score < 62) return "CAUTION";
  return "REJECT";
}

export async function screenCandidate(
  candidate: EnrichedCandidate,
  opts: ScreeningOptions = {},
): Promise<ScreeningReport> {
  const preset = getScreeningPreset(opts.preset ?? "normal");
  const checks: Record<string, ScreeningCheck> = {};
  const flags: string[] = [];
  let score = 0;

  const liquidityUsd = candidate.market.liquidityUsd;
  const pairAgeSec = candidate.market.pairAgeSec;
  const minLiquidityUsd = preset.minLpSol * 150;

  // ── Heuristic layer (always runs) ──
  if (liquidityUsd !== undefined) {
    const ok = liquidityUsd >= minLiquidityUsd;
    checks.liquidity = { pass: ok, value: liquidityUsd };
    if (ok) flags.push("LIQ_OK");
    else {
      flags.push("LOW_LIQ");
      score += 30;
    }
  } else {
    score += 10;
  }

  if (pairAgeSec !== undefined) {
    const ok = pairAgeSec >= 60;
    checks.pairAge = { pass: ok, value: pairAgeSec };
    if (!ok) {
      flags.push("TOO_NEW");
      score += 15;
    } else {
      flags.push(`PAIR_AGE_${Math.floor(pairAgeSec / 60)}M`);
    }
  }

  // ── On-chain authority layer (RPC) ──
  let onchainResolved = false;
  if (!opts.offline && opts.rpcUrl) {
    const connection: Connection = createConnection(opts.rpcUrl);
    const auth = await checkMintAuthorities(connection, candidate.mint);
    onchainResolved = auth.resolved;
    if (auth.resolved) {
      checks.mintAuthority = { pass: auth.mintAuthorityRevoked };
      checks.freezeAuthority = { pass: auth.freezeAuthorityRevoked };
      if (auth.mintAuthorityRevoked) flags.push("MINT_AUTH_REVOKED");
      else {
        flags.push("MINT_AUTH_LIVE");
        score += 40;
      }
      if (auth.freezeAuthorityRevoked) flags.push("FREEZE_AUTH_REVOKED");
      else {
        flags.push("FREEZE_AUTH_LIVE");
        score += 25;
      }
    }
  }

  // ── RugCheck layer (free API) ──
  let top10Pct: number | undefined;
  if (!opts.offline) {
    const rc = await fetchRugCheck(candidate.mint);
    if (rc) {
      checks.rugcheck = { pass: !rc.rugged, value: rc.score, note: rc.risks.join(",") };
      top10Pct = rc.topHolderPct;
      if (rc.rugged) {
        flags.push("RUGCHECK_RUGGED");
        score += 50;
      }
      if (rc.topHolderPct !== undefined) {
        if (rc.topHolderPct > preset.top10Max) {
          flags.push(`TOP10_${Math.round(rc.topHolderPct)}PCT`);
          score += 20;
        }
      }
      score += Math.min(rc.score / 10, 20);
    }
  }

  // If we never resolved on-chain authorities (offline / no key), add mild
  // uncertainty penalty so unverified tokens skew toward CAUTION not SAFE.
  if (!onchainResolved) score += 12;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    mint: candidate.mint,
    verdict: verdictFromScore(score),
    score,
    checks,
    liquidityUsd,
    pairAgeSec,
    top10Pct,
    mintAuthorityRevoked: checks.mintAuthority?.pass,
    freezeAuthorityRevoked: checks.freezeAuthority?.pass,
    flags: Array.from(new Set(flags)),
    ts: Date.now(),
  };
}
