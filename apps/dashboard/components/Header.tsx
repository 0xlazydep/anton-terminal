"use client";

import { useEffect, useState } from "react";
import { useUI } from "@/store/ui";
import { useRealizedPnl } from "@/hooks/use-positions";
import { SolIcon } from "@/components/ui/sol-icon";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn, fmtPct, fmtSol, fmtTime } from "@/lib/utils";

function StatusGlyph({ state }: { state: string }) {
  const map: Record<string, string> = {
    scanning: "◷ SCANNING",
    analyzing: "◓ ANALYZING",
    entering: "▶ ENTERING",
    watching: "◉ WATCHING",
    idle: "◌ IDLE",
  };
  return (
    <span className="flex items-center gap-2">
      <span className="dot-pulse text-foreground" aria-hidden />
      <span className="font-semibold tabular-nums">
        {map[state] ?? state.toUpperCase()}
      </span>
    </span>
  );
}

export function Header() {
  const { mode, status, solBalance } = useUI();
  const { realizedPnlSol, realizedPnlPct, winrate } = useRealizedPnl();
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const id = window.setInterval(() => setNow(fmtTime(Date.now())), 1000);
    setNow(fmtTime(Date.now()));
    return () => clearInterval(id);
  }, []);
  const up = realizedPnlSol >= 0;

  return (
    <header className="sticky top-0 z-30 flex h-12 w-full items-center gap-4 border-b border-[var(--border)] bg-background/95 px-4 backdrop-blur-sm">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 bg-foreground" aria-hidden />
        <h1 className="text-sm font-bold uppercase tracking-[0.32em]">
          ANTON
        </h1>
        <span className="hidden sm:inline text-[9px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
          TERMINAL · v0.1
        </span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Status */}
      <div className="text-[10px] uppercase tracking-[0.18em]">
        <StatusGlyph state={status} />
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Mode */}
      <Badge variant={mode === "live" ? "loss" : "outline"}>
        MODE · {mode === "live" ? "LIVE" : "DRY-RUN"}
      </Badge>

      <div className="flex-1" />

      {/* SOL balance */}
      <div className="hidden md:flex items-center gap-2">
        <SolIcon className="h-4 w-4" />
        <span className="text-xs font-semibold tabular-nums">
          {fmtSol(solBalance)}
        </span>
      </div>

      <Separator orientation="vertical" className="h-6 hidden md:block" />

      {/* Realized PnL (all-time, closed positions only) */}
      <div className="flex items-center gap-2">
        <span className="label-mono hidden sm:inline">REALIZED PnL</span>
        <span className="label-mono sm:hidden">PnL</span>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            up ? "text-[var(--profit)]" : "text-[var(--loss)]",
          )}
        >
          {up ? "+" : ""}
          {fmtSol(realizedPnlSol)} <SolIcon className="inline h-3 w-3 -mt-0.5" /> · {fmtPct(realizedPnlPct)}
        </span>
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.14em] tabular-nums ml-2",
            winrate >= 50 ? "text-[var(--profit)]" : "text-[var(--loss)]",
          )}
        >
          WR {winrate.toFixed(0)}%
        </span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Clock */}
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)] tabular-nums">
        {now} UTC
      </span>
    </header>
  );
}
