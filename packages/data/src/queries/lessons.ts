import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { lessons, patternStats } from "../schema/memory.js";

export interface LessonInput {
  category: string;
  summary: string;
  severity: "critical" | "important" | "note";
  source?: string;
  tradeIds?: string[];
}

export async function insertLesson(
  db: Database,
  input: LessonInput,
): Promise<void> {
  await db.insert(lessons).values({
    category: input.category,
    summary: input.summary,
    severity: input.severity as "critical" | "important" | "note",
    source: input.source ?? "trade",
    tradeIds: input.tradeIds ?? [],
  });
}

export async function getRecentLessons(
  db: Database,
  limit = 5,
): Promise<Array<{ category: string; summary: string; severity: string }>> {
  const rows = await db
    .select({
      category: lessons.category,
      summary: lessons.summary,
      severity: lessons.severity,
    })
    .from(lessons)
    .where(eq(lessons.retired, false))
    .orderBy(desc(lessons.createdAt))
    .limit(limit);

  return rows;
}

export interface PatternStatInput {
  category: string;
  key: string;
  isWin: boolean;
  pnlSol: number;
  pnlPct: number;
}

export async function upsertPatternStat(
  db: Database,
  input: PatternStatInput,
): Promise<void> {
  const existing = await db
    .select()
    .from(patternStats)
    .where(
      and(
        eq(patternStats.category, input.category),
        eq(patternStats.key, input.key),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    const newWins = row.totalWins + (input.isWin ? 1 : 0);
    const newLosses = row.totalLosses + (input.isWin ? 0 : 1);
    const newTotal = newWins + newLosses;
    await db
      .update(patternStats)
      .set({
        totalTrades: newTotal,
        totalWins: newWins,
        totalLosses: newLosses,
        totalPnlSol: row.totalPnlSol + input.pnlSol,
        avgPnlPct: ((row.avgPnlPct * row.totalTrades) + input.pnlPct) / newTotal,
        updatedAt: sql`now()`,
      })
      .where(eq(patternStats.id, row.id));
  } else {
    await db.insert(patternStats).values({
      category: input.category,
      key: input.key,
      totalTrades: 1,
      totalWins: input.isWin ? 1 : 0,
      totalLosses: input.isWin ? 0 : 1,
      totalPnlSol: input.pnlSol,
      avgPnlPct: input.pnlPct,
    });
  }
}

export async function getPatternStats(
  db: Database,
  category?: string,
): Promise<Array<{
  category: string;
  key: string;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: number | null;
  avgPnlPct: number;
}>> {
  const rows = await db
    .select()
    .from(patternStats)
    .where(category ? eq(patternStats.category, category) : undefined)
    .orderBy(desc(patternStats.totalTrades));

  return rows.map((r) => ({
    category: r.category,
    key: r.key,
    totalTrades: r.totalTrades,
    totalWins: r.totalWins,
    totalLosses: r.totalLosses,
    winRate: r.totalTrades > 0 ? r.totalWins / r.totalTrades : null,
    avgPnlPct: r.avgPnlPct,
  }));
}
