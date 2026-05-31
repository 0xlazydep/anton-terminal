import { desc } from "drizzle-orm";
import type { Database } from "../db.js";
import { balanceSnapshots } from "../schema/trades.js";

export interface BalanceSnapshotInput {
  ts: number;
  solBalance: number;
  startingSol: number;
  totalPnlSol: number;
}

export interface BalanceSnapshotRow {
  ts: number;
  solBalance: number;
  startingSol: number;
  totalPnlSol: number;
}

export async function insertBalanceSnapshot(
  db: Database,
  input: BalanceSnapshotInput,
): Promise<void> {
  await db.insert(balanceSnapshots).values({
    ts: new Date(input.ts),
    solBalance: input.solBalance,
    startingSol: input.startingSol,
    totalPnlSol: input.totalPnlSol,
  });
}

export async function listRecentBalanceSnapshots(
  db: Database,
  limit = 240,
): Promise<BalanceSnapshotRow[]> {
  const rows = await db
    .select()
    .from(balanceSnapshots)
    .orderBy(desc(balanceSnapshots.ts))
    .limit(limit);
  return rows
    .map((r) => ({
      ts: r.ts.getTime(),
      solBalance: r.solBalance,
      startingSol: r.startingSol,
      totalPnlSol: r.totalPnlSol,
    }))
    .sort((a, b) => a.ts - b.ts);
}
