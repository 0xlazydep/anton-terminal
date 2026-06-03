"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MintLink } from "@/components/ui/mint-link";
import { cn, fmtTime } from "@/lib/utils";
import type { ScreeningResultEvent } from "@anton/shared-types";

function SourceBadge({ source }: { source?: string }) {
  const label =
    source === "dexscreener_trending" ? "DEX" :
    source === "pumpfun_new" ? "PFN" :
    source === "pumpfun_migration" ? "PFM" :
    source === "axiom_trending" ? "AX" :
    source === "jupiter_trending" ? "JUP" :
    source === "social_trending" ? "SOC" :
    source === "smart_wallet" ? "SW" :
    source === "manual" ? "MAN" :
    source ? source.slice(0, 3).toUpperCase() : "—";
  return (
    <Badge variant="outline" className="text-[8px] px-1">
      {label}
    </Badge>
  );
}

function VerdictBadge({ verdict }: { verdict: "SAFE" | "CAUTION" | "REJECT" }) {
  if (verdict === "SAFE")
    return <Badge variant="profit">● SAFE</Badge>;
  if (verdict === "CAUTION")
    return <Badge variant="outline">◐ CAUTION</Badge>;
  return <Badge variant="loss">⨯ REJECT</Badge>;
}

function ScoreBar({ score }: { score: number }) {
  // lower is safer (0..100)
  const w = Math.min(100, Math.max(0, score));
  return (
    <div className="relative h-1 w-full bg-foreground/10">
      <div
        className={cn(
          "absolute inset-y-0 left-0",
          score < 30
            ? "bg-[var(--profit)]"
            : score < 60
              ? "bg-foreground"
              : "bg-[var(--loss)]",
        )}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

export function Screening() {
  const { data } = useQuery<ScreeningResultEvent[]>({
    queryKey: ["screening"],
    initialData: [],
    queryFn: async () => [],
  });
  const rows = data ?? [];
  const safe = rows.filter((r) => r.verdict === "SAFE").length;
  const reject = rows.filter((r) => r.verdict === "REJECT").length;
  const skipped = rows.filter((r) => r.llmAction === "SKIP").length;
  const bought = rows.filter((r) => r.llmAction === "BUY").length;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>LIVE SCREENING</CardTitle>
          <Badge variant="outline">PIPELINE · 4 LAYERS</Badge>
        </div>
        <div className="flex items-center gap-3 tabular-nums">
          <span className="label-mono">
            <span className="text-[var(--profit)]">{safe}</span> SAFE
          </span>
          <span className="label-mono">
            <span className="text-[var(--loss)]">{reject}</span> REJECT
          </span>
          <span className="label-mono">
            <span className="text-[var(--muted-foreground)]">{skipped}</span> SKIP
          </span>
          <span className="label-mono">
            <span className="text-foreground">{bought}</span> BUY
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-auto">
        <Table>
          <THead>
            <TR>
              <TH>TS</TH>
              <TH>SYM</TH>
              <TH>SRC</TH>
              <TH>MINT</TH>
              <TH className="text-right">SCORE</TH>
              <TH className="w-[120px]">RISK</TH>
              <TH className="text-right">LIQ</TH>
              <TH className="text-right">MC</TH>
              <TH className="text-right">AGE</TH>
              <TH>FLAGS</TH>
              <TH className="text-right">VERDICT</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={`${r.mint}-${r.ts ?? "na"}-${i}`} className="animate-slide-in">
                <TD className="text-[var(--muted-foreground)]">
                  {r.ts ? fmtTime(r.ts) : "—"}
                </TD>
                <TD className="font-semibold">{r.symbol ?? "—"}</TD>
                <TD>
                  <SourceBadge source={r.source} />
                </TD>
                <TD className="text-[var(--muted-foreground)]">
                  <MintLink mint={r.mint} />
                </TD>
                <TD className="text-right tabular-nums">
                  {r.score.toString().padStart(2, "0")}
                </TD>
                <TD>
                  <ScoreBar score={r.score} />
                </TD>
                <TD className="text-right tabular-nums">
                  {r.liquidityUsd != null
                    ? `$${(r.liquidityUsd / 1000).toFixed(1)}K`
                    : "—"}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.marketCapUsd != null
                    ? `$${(r.marketCapUsd / 1000).toFixed(1)}K`
                    : "—"}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.pairAgeSec != null
                    ? `${Math.floor(r.pairAgeSec / 60)}m`
                    : "—"}
                </TD>
                <TD className="space-x-1">
                  {r.flags.slice(0, 2).map((f) => (
                    <Badge key={f} variant="outline" className="text-[8px]">
                      {f}
                    </Badge>
                  ))}
                  {r.flags.length > 2 && (
                    <span className="text-[9px] text-[var(--muted-foreground)]">
                      +{r.flags.length - 2}
                    </span>
                  )}
                </TD>
                <TD className="text-right flex items-center gap-1 justify-end">
                  {r.llmAction === "BUY" && (
                    <Badge variant="profit" className="text-[8px]">▲ BUY</Badge>
                  )}
                  {r.llmAction === "SKIP" && (
                    <Badge variant="outline" className="text-[8px] text-[var(--muted-foreground)]">⨯ SKIP</Badge>
                  )}
                  <VerdictBadge verdict={r.verdict} />
                </TD>
              </TR>
            ))}
            {rows.length === 0 && (
              <TR>
                <TD
                  colSpan={11}
                  className="py-6 text-center text-[var(--muted-foreground)] uppercase tracking-[0.16em] text-[10px]"
                >
                  AWAITING CANDIDATES
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </CardContent>
      <CardFooter>
        <span>ON-CHAIN → DEXSCREENER → RUGCHECK → DEEP</span>
        <span>{rows.length} TOTAL</span>
      </CardFooter>
    </Card>
  );
}
