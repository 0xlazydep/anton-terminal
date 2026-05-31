import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db.js";
import { positions } from "../schema/trades.js";
import type { ExecutionMode } from "@anton/shared-types";

export interface InsertOpenPositionInput {
  id: string;
  mint: string;
  symbol?: string;
  sizeSol: number;
  entryPriceUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
  mode: ExecutionMode;
  entryMarketCapUsd?: number;
  openedAt: number;
}

export interface ClosePositionInput {
  id: string;
  exitPriceUsd: number;
  pnlSol: number;
  pnlPct: number;
  reason: string;
  closedAt: number;
}

export interface OpenPositionRow {
  id: string;
  mint: string;
  symbol?: string;
  sizeSol: number;
  entryPriceUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
  mode: ExecutionMode;
  entryMarketCapUsd?: number;
  openedAt: number;
}

export interface ClosedPositionRow extends OpenPositionRow {
  exitPriceUsd: number;
  pnlSol: number;
  pnlPct: number;
  reason: string;
  closedAt: number;
}

export async function insertOpenPosition(
  db: Database,
  input: InsertOpenPositionInput,
): Promise<void> {
  await db
    .insert(positions)
    .values({
      id: input.id,
      mint: input.mint,
      symbol: input.symbol ?? null,
      sizeSol: input.sizeSol,
      entryPriceUsd: input.entryPriceUsd,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
      mode: input.mode,
      status: "OPEN",
      entryMarketCapUsd: input.entryMarketCapUsd ?? null,
      openedAt: new Date(input.openedAt),
    })
    .onConflictDoNothing({ target: positions.id });
}

export async function closePosition(
  db: Database,
  input: ClosePositionInput,
): Promise<void> {
  const holdSeconds = await db
    .select({ openedAt: positions.openedAt })
    .from(positions)
    .where(eq(positions.id, input.id))
    .limit(1)
    .then((rows) => {
      const openedAt = rows[0]?.openedAt;
      if (!openedAt) return null;
      return Math.max(0, Math.floor((input.closedAt - openedAt.getTime()) / 1000));
    });

  await db
    .update(positions)
    .set({
      status: "CLOSED",
      exitPriceUsd: input.exitPriceUsd,
      pnlSol: input.pnlSol,
      pnlPct: input.pnlPct,
      closedAt: new Date(input.closedAt),
      holdSeconds: holdSeconds ?? null,
      episode: { reason: input.reason },
    })
    .where(eq(positions.id, input.id));
}

export async function listOpenPositions(
  db: Database,
  mode?: string,
): Promise<OpenPositionRow[]> {
  const rows = await db
    .select()
    .from(positions)
    .where(mode ? and(eq(positions.status, "OPEN"), eq(positions.mode, mode as any)) : eq(positions.status, "OPEN"))
    .orderBy(desc(positions.openedAt));
  return rows.map(mapOpenRow);
}

export async function listClosedPositions(
  db: Database,
  limit = 100,
  mode?: string,
): Promise<ClosedPositionRow[]> {
  const rows = await db
    .select()
    .from(positions)
    .where(mode ? and(eq(positions.status, "CLOSED"), eq(positions.mode, mode as any)) : eq(positions.status, "CLOSED"))
    .orderBy(desc(positions.closedAt))
    .limit(limit);
  return rows.map((r) => {
    const reason =
      r.episode && typeof r.episode === "object" && "reason" in r.episode
        ? String((r.episode as { reason: unknown }).reason)
        : "closed";
    return {
      ...mapOpenRow(r),
      exitPriceUsd: r.exitPriceUsd ?? 0,
      pnlSol: r.pnlSol ?? 0,
      pnlPct: r.pnlPct ?? 0,
      reason,
      closedAt: r.closedAt?.getTime() ?? Date.now(),
    };
  });
}

type PositionSelect = typeof positions.$inferSelect;

function mapOpenRow(r: PositionSelect): OpenPositionRow {
  return {
    id: r.id,
    mint: r.mint,
    symbol: r.symbol ?? undefined,
    sizeSol: r.sizeSol,
    entryPriceUsd: r.entryPriceUsd ?? 0,
    stopLossPct: r.stopLossPct ?? 0,
    takeProfitPct: r.takeProfitPct ?? 0,
    mode: r.mode,
    entryMarketCapUsd: r.entryMarketCapUsd ?? undefined,
    openedAt: r.openedAt?.getTime() ?? Date.now(),
  };
}
