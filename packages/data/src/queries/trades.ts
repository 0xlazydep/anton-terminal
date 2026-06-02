import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { trades } from "../schema/trades.js";
import type { ExecutionMode } from "@anton/shared-types";

export interface RecordTradeInput {
  mint: string;
  symbol?: string;
  direction: "BUY" | "SELL";
  /** SOL leg size requested for the trade. */
  sizeSol: number;
  /** Ground-truth SOL the wallet actually moved (positive = spent on BUY). */
  actualSolSpent?: number;
  priceUsd?: number;
  priceSol?: number;
  tokenAmount?: number;
  slippageBps?: number;
  /** Total fee in SOL (priority fee + base network fee + rent), if known. */
  feeSol?: number;
  /** Priority fee Jupiter reported, in SOL. */
  priorityFeeSol?: number;
  txSignature?: string;
  route?: string;
  mode: ExecutionMode;
  status?: "PENDING" | "CONFIRMED" | "FAILED" | "SIMULATED";
  priceImpactPct?: number;
}

/**
 * Persist a single executed swap with its real cost components so fees,
 * slippage, and priority-fee spend can be decomposed later. Idempotent on
 * txSignature (unique) — a retried persist will not double-count.
 */
export async function recordTrade(db: Database, input: RecordTradeInput): Promise<void> {
  await db
    .insert(trades)
    .values({
      mint: input.mint,
      symbol: input.symbol ?? null,
      direction: input.direction,
      sizeSol: input.sizeSol,
      priceUsd: input.priceUsd ?? null,
      priceSol: input.priceSol ?? null,
      tokenAmount: input.tokenAmount ?? null,
      slippageBps: input.slippageBps ?? null,
      feeSol: input.feeSol ?? null,
      txSignature: input.txSignature ?? null,
      route: input.route ?? "jupiter",
      mode: input.mode,
      status: input.status ?? "CONFIRMED",
      confirmedAt: input.status === "CONFIRMED" || !input.status ? new Date() : null,
      metadata: {
        actualSolSpent: input.actualSolSpent,
        priorityFeeSol: input.priorityFeeSol,
        priceImpactPct: input.priceImpactPct,
      },
    })
    .onConflictDoNothing({ target: trades.txSignature });
}

export interface FeeBreakdown {
  tradeCount: number;
  /** Sum of all fee_sol (priority + base + rent) across trades. */
  totalFeeSol: number;
  /** Sum of priority-fee portion (from metadata), in SOL. */
  totalPriorityFeeSol: number;
  /** Average realized slippage in bps across trades that recorded it. */
  avgSlippageBps: number;
  /** Estimated SOL lost to slippage: sum over trades of sizeSol * slippageBps/10000. */
  estSlippageCostSol: number;
  /** Average Jupiter price impact (fraction) across trades. */
  avgPriceImpactPct: number;
}

/**
 * Aggregate the real cost components across recorded trades so the dashboard /
 * operator can see how much of the balance bleed is fee vs slippage vs priority
 * fee — the decomposition that was impossible before trades were persisted.
 */
export async function getFeeBreakdown(
  db: Database,
  opts?: { sinceMs?: number; mode?: ExecutionMode },
): Promise<FeeBreakdown> {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts?.mode) conds.push(eq(trades.mode, opts.mode));
  if (opts?.sinceMs) conds.push(gte(trades.createdAt, new Date(opts.sinceMs)));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const rows = await db
    .select({
      count: sql<number>`count(*)`,
      totalFee: sql<number>`coalesce(sum(${trades.feeSol}), 0)`,
      totalPriorityFee: sql<number>`coalesce(sum((${trades.metadata}->>'priorityFeeSol')::double precision), 0)`,
      avgSlippage: sql<number>`coalesce(avg(${trades.slippageBps}), 0)`,
      slippageCost: sql<number>`coalesce(sum(${trades.sizeSol} * coalesce(${trades.slippageBps}, 0) / 10000.0), 0)`,
      avgPriceImpact: sql<number>`coalesce(avg((${trades.metadata}->>'priceImpactPct')::double precision), 0)`,
    })
    .from(trades)
    .where(where);

  const r = rows[0];
  return {
    tradeCount: Number(r?.count ?? 0),
    totalFeeSol: Number(r?.totalFee ?? 0),
    totalPriorityFeeSol: Number(r?.totalPriorityFee ?? 0),
    avgSlippageBps: Number(r?.avgSlippage ?? 0),
    estSlippageCostSol: Number(r?.slippageCost ?? 0),
    avgPriceImpactPct: Number(r?.avgPriceImpact ?? 0),
  };
}
