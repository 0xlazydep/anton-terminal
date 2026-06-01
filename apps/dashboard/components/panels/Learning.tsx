"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Lesson {
  category: string;
  summary: string;
  severity: string;
}

interface PatternStat {
  category: string;
  key: string;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: number | null;
  avgPnlPct: number;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical")
    return <Badge variant="loss" className="text-[8px]">CRIT</Badge>;
  if (severity === "important")
    return <Badge variant="outline" className="text-[8px] text-[var(--warning)]">IMP</Badge>;
  return <Badge variant="outline" className="text-[8px]">NOTE</Badge>;
}

export function Learning() {
  const { data: lessons } = useQuery<Lesson[]>({
    queryKey: ["recent-lessons"],
    initialData: [],
    queryFn: async () => [],
  });

  const { data: stats } = useQuery<PatternStat[]>({
    queryKey: ["pattern-stats"],
    initialData: [],
    queryFn: async () => [],
  });

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>LEARNING</CardTitle>
          <Badge variant="outline">ADAPTIVE · SELF-IMPROVING</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-row gap-3 p-3 overflow-auto">
        {/* Recent Lessons */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            RECENT LESSONS ({lessons.length})
          </span>
          <div className="overflow-auto">
            {lessons.length === 0 ? (
              <p className="text-[10px] text-[var(--muted-foreground)] italic py-2">
                No lessons yet...
              </p>
            ) : (
              lessons.map((l, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 border border-[var(--border)] p-2 mb-1 last:mb-0"
                >
                  <SeverityBadge severity={l.severity} />
                  <span className="text-[10px] text-foreground leading-relaxed break-words">
                    {l.summary}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pattern Stats */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            PATTERN STATS
          </span>
          {stats.length === 0 ? (
            <p className="text-[10px] text-[var(--muted-foreground)] italic py-2">
              Accumulating trade data...
            </p>
          ) : (
            <div className="border border-[var(--border)]">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="text-left px-2 py-1 font-medium uppercase tracking-[0.12em]">Pattern</th>
                    <th className="text-right px-2 py-1 font-medium uppercase tracking-[0.12em]">W/L</th>
                    <th className="text-right px-2 py-1 font-medium uppercase tracking-[0.12em]">WR</th>
                    <th className="text-right px-2 py-1 font-medium uppercase tracking-[0.12em]">Avg PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.slice(0, 20).map((s, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-[var(--border)] last:border-b-0",
                        (s.winRate ?? 0) >= 0.5
                          ? "bg-[var(--profit)]/5"
                          : (s.totalTrades >= 3 && (s.winRate ?? 0) < 0.3)
                            ? "bg-[var(--loss)]/5"
                            : "",
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <span className="text-[var(--muted-foreground)]">{s.category}/</span>
                        {s.key}
                      </td>
                      <td className="text-right px-2 py-1.5 tabular-nums">
                        {s.totalWins}W/{s.totalLosses}L
                      </td>
                      <td className={cn(
                        "text-right px-2 py-1.5 tabular-nums font-semibold",
                        (s.winRate ?? 0) >= 0.5 ? "text-[var(--profit)]" : "text-[var(--loss)]",
                      )}>
                        {s.winRate !== null ? (s.winRate * 100).toFixed(0) + "%" : "—"}
                      </td>
                      <td className={cn(
                        "text-right px-2 py-1.5 tabular-nums",
                        s.avgPnlPct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]",
                      )}>
                        {s.avgPnlPct >= 0 ? "+" : ""}{s.avgPnlPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
