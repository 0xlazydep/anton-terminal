"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SolIcon } from "@/components/ui/sol-icon";
import { cn, fmtSol } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import type { FeeBreakdownEvent } from "@anton/shared-types";

function RatioBar({ value, label, height = 8 }: { value: number; label: string; height?: number }) {
  const clamped = Math.min(value, 1);
  const pct = (clamped * 100).toFixed(0);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--muted-foreground)] w-16 text-right tabular-nums">{label}</span>
      <div className="flex-1 h-[var(--h)] bg-[var(--border)]" style={{ "--h": `${height}px` } as React.CSSProperties}>
        <div
          className={cn("h-full transition-all", clamped > 0.5 ? "bg-[var(--loss)]" : "bg-[var(--profit)]")}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span className={cn("text-[10px] tabular-nums w-10", clamped > 0.5 ? "text-[var(--loss)]" : "text-[var(--profit)]")}>{pct}%</span>
    </div>
  );
}

export function FeeBreakdown() {
  const [data, setData] = useState<FeeBreakdownEvent | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const sock = getSocket();
    const handler = (e: FeeBreakdownEvent) => {
      setData(e);
      setStale(false);
    };
    sock.on("fee_breakdown", handler);
    const timer = setInterval(() => setStale(true), 30_000);
    return () => { sock.off("fee_breakdown", handler); clearInterval(timer); };
  }, []);

  if (!data) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle>FEE ANALYSIS</CardTitle></CardHeader>
        <CardContent className="p-3">
          <p className="text-[10px] text-[var(--muted-foreground)] italic">Waiting for trade data...</p>
        </CardContent>
      </Card>
    );
  }

  const feeRatioColor = data.feeToProfitRatio > 0.5 ? "text-[var(--loss)]" : data.feeToProfitRatio > 0.2 ? "text-[var(--warning)]" : "text-[var(--profit)]";

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>FEE ANALYSIS</CardTitle>
          <Badge variant="outline" className={cn(stale ? "opacity-40" : "")}>{stale ? "STALE" : "LIVE"}</Badge>
          <Badge variant="outline">{data.tradeCount} TRADES</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 flex flex-col gap-2 overflow-auto">
        <div className="grid grid-cols-3 gap-2">
          <div className="border border-[var(--border)] p-2 text-center">
            <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-[0.14em]">Total Fees</div>
            <div className="text-sm tabular-nums"><span className="text-[var(--loss)]">{fmtSol(data.totalFeeSol)}</span> <SolIcon className="inline h-3 w-3 -mt-0.5" /></div>
          </div>
          <div className="border border-[var(--border)] p-2 text-center">
            <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-[0.14em]">Per Trade</div>
            <div className="text-sm tabular-nums"><span className="text-[var(--loss)]">{fmtSol(data.avgFeePerTradeSol)}</span> <SolIcon className="inline h-3 w-3 -mt-0.5" /></div>
          </div>
          <div className="border border-[var(--border)] p-2 text-center">
            <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-[0.14em]">Fee/Profit</div>
            <div className={cn("text-sm tabular-nums font-semibold", feeRatioColor)}>{(data.feeToProfitRatio * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">FEE-TO-PROFIT RATIO</div>
          <RatioBar value={data.feeToProfitRatio} label="ratio" height={12} />
          {data.feeToProfitRatio > 0.3 && (
            <p className="text-[9px] text-[var(--loss)]">
              {data.feeToProfitRatio > 0.5
                ? "Fees consuming >50% of returns — consider fewer, higher-conviction trades"
                : "Fees eating significant portion of returns — monitor closely"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1 pt-1">
          <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">FEES BY SOURCE</div>
          <div className="border border-[var(--border)] p-2">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <th className="text-left py-1 font-medium uppercase tracking-[0.10em]">Source</th>
                  <th className="text-right py-1 font-medium uppercase tracking-[0.10em]">Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--border)]">
                  <td className="py-1">Priority Fees</td>
                  <td className="text-right tabular-nums text-[var(--loss)]">{fmtSol(data.totalPriorityFeeSol)} <SolIcon className="inline h-2.5 w-2.5 -mt-0.5" /></td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <td className="py-1">Network + Jito</td>
                  <td className="text-right tabular-nums text-[var(--loss)]">{fmtSol(Math.max(0, data.totalFeeSol - data.totalPriorityFeeSol))} <SolIcon className="inline h-2.5 w-2.5 -mt-0.5" /></td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <td className="py-1">Slippage (est)</td>
                  <td className="text-right tabular-nums text-[var(--loss)]">{fmtSol(data.estSlippageCostSol)} <SolIcon className="inline h-2.5 w-2.5 -mt-0.5" /></td>
                </tr>
                <tr>
                  <td className="py-1">Avg Slippage</td>
                  <td className="text-right tabular-nums text-[var(--muted-foreground)]">{data.avgSlippageBps.toFixed(0)} bps</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {data.avgPriceImpactPct > 0 && (
          <div className="text-[10px] text-[var(--muted-foreground)] pt-1">
            Avg Price Impact: {(data.avgPriceImpactPct * 100).toFixed(2)}%
          </div>
        )}
      </CardContent>
    </Card>
  );
}
