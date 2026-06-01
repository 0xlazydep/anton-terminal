"use client";

import { useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useReasoningEntries, type ReasoningEntry } from "@/hooks/use-reasoning";
import { fmtTime, cn } from "@/lib/utils";

function ActionGlyph({
  action,
}: {
  action: "BUY" | "SELL" | "HOLD" | "SKIP" | "SET_SL" | "SET_TP" | "EXIT";
}) {
  switch (action) {
    case "BUY":
      return (
        <Badge variant="profit" className="shrink-0">
          ▲ BUY
        </Badge>
      );
    case "SELL":
      return (
        <Badge variant="loss" className="shrink-0">
          ▼ SELL
        </Badge>
      );
    case "SKIP":
      return (
        <Badge variant="outline" className="shrink-0 text-[var(--muted-foreground)]">
          ⨯ SKIP
        </Badge>
      );
    case "HOLD":
      return (
        <Badge variant="outline" className="shrink-0">
          ◼ HOLD
        </Badge>
      );
    case "SET_SL":
      return (
        <Badge variant="loss" className="shrink-0">
          SL
        </Badge>
      );
    case "SET_TP":
      return (
        <Badge variant="profit" className="shrink-0">
          TP
        </Badge>
      );
    case "EXIT":
      return (
        <Badge variant="loss" className="shrink-0">
          ◀ EXIT
        </Badge>
      );
    default:
      return null;
  }
}

function Row({ entry }: { entry: ReasoningEntry }) {
  if (entry.kind === "step") {
    const { step, thought, confidence, ts } = entry.data;
    return (
      <div className="grid grid-cols-[56px_42px_auto_1fr] items-start gap-2 px-3 py-1 text-[11px] leading-relaxed animate-slide-in">
        <span className="tabular-nums text-[var(--muted-foreground)]">
          {fmtTime(ts)}
        </span>
        <span className="tabular-nums text-[var(--muted-foreground)]">
          #{step.toString().padStart(4, "0")}
        </span>
        <span className="text-[var(--muted-foreground)] uppercase tracking-[0.14em] text-[9px] pt-[2px]">
          REASON
        </span>
        <span className="text-foreground">
          {thought}
          {confidence !== undefined && (
            <span className="ml-2 text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              · CONF {(confidence * 100).toFixed(0)}%
            </span>
          )}
        </span>
      </div>
    );
  }
  const { mint, symbol, action, conviction, sizeSol, reason } = entry.data;
  const ts = entry.ts;
  return (
    <div
      className={cn(
        "grid grid-cols-[56px_42px_auto_1fr] items-start gap-2 border-l-2 px-3 py-1.5 text-[11px] leading-relaxed bg-foreground/[0.04] animate-slide-in",
        action === "BUY"
          ? "border-[var(--profit)]"
          : action === "SELL" || action === "SET_SL"
            ? "border-[var(--loss)]"
            : "border-foreground/40",
      )}
    >
      <span className="tabular-nums text-[var(--muted-foreground)]">
        {fmtTime(ts)}
      </span>
      <span className="tabular-nums text-foreground font-semibold">
        DEC
      </span>
      <ActionGlyph action={action} />
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-foreground">
          <span className="font-semibold">{symbol ?? "—"}</span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            {mint.slice(0, 4)}…{mint.slice(-4)}
          </span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            · CONV {(conviction * 100).toFixed(0)}%
          </span>
          {sizeSol !== undefined && (
            <span className="text-[9px] uppercase tracking-[0.14em] text-foreground">
              · SIZE {sizeSol} SOL
            </span>
          )}
        </div>
        <span className="text-foreground/90 italic">"{reason}"</span>
      </div>
    </div>
  );
}

export function ReasoningLog() {
  const entries = useReasoningEntries();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
    isPinnedRef.current = dist < 24;
  };

  const lastDecisionCount = entries.filter((e) => e.kind === "decision").length;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="dot-pulse text-foreground" aria-hidden />
          <CardTitle>AGENT REASONING · LIVE</CardTitle>
          <Badge variant="outline">SSE · /api/agent/stream</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="label-mono">{entries.length} steps</span>
          <span className="label-mono">{lastDecisionCount} dec</span>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto font-mono"
          role="log"
          aria-live="polite"
          aria-atomic="false"
        >
          {entries.map((e, i) => (
            <Row
              key={
                e.kind === "step"
                  ? `s-${e.data.step}-${i}`
                  : `d-${e.ts}-${i}`
              }
              entry={e}
            />
          ))}
          <div className="px-3 py-1 text-[11px] text-[var(--muted-foreground)] caret">
            &gt;{" "}
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <span>RING BUFFER · 500</span>
        <span>{isPinnedRef.current ? "AUTO-SCROLL ON" : "SCROLL PAUSED"}</span>
      </CardFooter>
    </Card>
  );
}
