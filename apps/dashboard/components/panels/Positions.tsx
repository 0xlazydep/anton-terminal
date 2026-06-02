"use client";

import { useState } from "react";
import { Card, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TH, THead, TR, TD, Table } from "@/components/ui/table";
import { MintLink } from "@/components/ui/mint-link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePositions,
  usePositionHistory,
  useRealizedPnl,
} from "@/hooks/use-positions";
import { useQuery } from "@tanstack/react-query";
import {
  cn,
  fmtHold,
  fmtMc,
  fmtPct,
  fmtSol,
  fmtUsd,
} from "@/lib/utils";
import { SolIcon } from "@/components/ui/sol-icon";
import { useBlink } from "@/hooks/use-blink";

function PositionRow({ p, now }: { p: ReturnType<typeof usePositions>["positions"][number]; now: number }) {
  const up = p.pnlPct >= 0;
  const hold = Math.floor((now - p.openedAt) / 1000);
  const pnlBlink = useBlink(p.pnlPct);
  const pnlClass = pnlBlink === "up" ? "animate-blink-up" : pnlBlink === "down" ? "animate-blink-down" : "";

  return (
    <TR>
      <TD className="font-semibold">{p.symbol ?? "—"}</TD>
      <TD className="text-[var(--muted-foreground)]">
        <MintLink mint={p.mint} />
      </TD>
      <TD className="text-right">{fmtSol(p.sizeSol)}</TD>
      <TD className="text-right">{fmtUsd(p.entryPriceUsd)}</TD>
      <TD className="text-right text-[var(--muted-foreground)]">{fmtMc(p.entryMarketCapUsd)}</TD>
      <TD className="text-right">{fmtUsd(p.currentPriceUsd)}</TD>
      <TD className="text-right">{fmtMc(p.currentMarketCapUsd)}</TD>
      <TD
        className={cn(
          "text-right font-semibold transition-colors",
          up ? "text-[var(--profit)]" : "text-[var(--loss)]",
          pnlClass,
        )}
      >
        {fmtPct(p.pnlPct)}
      </TD>
      <TD
        className={cn(
          "text-right transition-colors",
          up ? "text-[var(--profit)]" : "text-[var(--loss)]",
          pnlClass,
        )}
      >
        {up ? "+" : ""}
        {fmtSol(p.pnlSol)}
      </TD>
      <TD className="text-right text-[var(--muted-foreground)]">
        -{p.slPct}% / +{p.tpPct}%
      </TD>
      <TD className="text-right">{fmtHold(hold)}</TD>
      <TD className="text-right">
        <Badge
          variant={p.mode === "live" ? "solid" : "outline"}
          className="text-[8px]"
        >
          {p.mode === "live" ? "LIVE" : "DRY"}
        </Badge>
      </TD>
    </TR>
  );
}

export function Positions() {
  const { positions, totalPnlSol, totalPnlPct, totalSizeSol } = usePositions();
  const history = usePositionHistory();
  const { realizedPnlSol, realizedPnlPct } = useRealizedPnl();
  const [tab, setTab] = useState("active");
  const now = Date.now();

  interface WatchItem { mint: string; symbol?: string; cycleCount: number; momentum: number; score: number; liquidityUsd?: number; pairAgeSec?: number; }
  const { data: watchlist } = useQuery<WatchItem[]>({
    queryKey: ["watchlist"],
    initialData: [],
    queryFn: async () => [],
  });

  const showActive = tab === "active";
  const pnlSol = showActive ? totalPnlSol : realizedPnlSol;
  const pnlPct = showActive ? totalPnlPct : realizedPnlPct;
  const pnlUp = pnlSol >= 0;

  return (
    <Card className="h-full">
      <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <TabsList className="border-b-0">
            <TabsTrigger value="active">
              ACTIVE
              <Badge variant="outline" className="ml-2">{positions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="watchlist">
              WATCH
              <Badge variant="outline" className="ml-2">{watchlist.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="history">
              HISTORY
              <Badge variant="outline" className="ml-2">{history.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="label-mono">
              {showActive ? "UNREALIZED PnL" : "REALIZED PnL"}
            </span>
            <span
              className={cn(
                "text-xs font-semibold",
                pnlUp ? "text-[var(--profit)]" : "text-[var(--loss)]",
              )}
            >
              {pnlUp ? "+" : ""}
              {fmtSol(pnlSol)} <SolIcon className="inline h-3 w-3 -mt-0.5" /> · {fmtPct(pnlPct)}
            </span>
            {showActive && (
              <>
                <span className="label-mono ml-4">POSITION</span>
                <span className="text-xs font-semibold">{fmtSol(totalSizeSol)} <SolIcon className="inline h-3 w-3 -mt-0.5" /></span>
              </>
            )}
          </div>
        </div>

        <TabsContent value="active" className="min-h-0 flex-1 overflow-auto pt-0">
          <Table>
            <THead>
              <TR>
                <TH>SYM</TH>
                <TH>MINT</TH>
                <TH className="text-right">SIZE</TH>
                <TH className="text-right">ENTRY</TH>
                <TH className="text-right">ENTRY MC</TH>
                <TH className="text-right">PRICE</TH>
                <TH className="text-right">MC</TH>
                <TH className="text-right">PnL %</TH>
                <TH className="text-right">PnL <SolIcon className="inline h-3 w-3" /></TH>
                <TH className="text-right">SL/TP</TH>
                <TH className="text-right">HOLD</TH>
                <TH className="text-right">MODE</TH>
              </TR>
            </THead>
            <TBody>
              {positions.map((p) => (
                <PositionRow key={p.id} p={p} now={now} />
              ))}
              {positions.length === 0 && (
                <TR>
                  <TD
                    colSpan={12}
                    className="py-6 text-center text-[var(--muted-foreground)] uppercase tracking-[0.16em] text-[10px]"
                  >
                    NO OPEN POSITIONS
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </TabsContent>

        <TabsContent value="watchlist" className="min-h-0 flex-1 overflow-auto pt-0">
          <Table>
            <THead>
              <TR>
                <TH>SYM</TH>
                <TH>MINT</TH>
                <TH className="text-right">LIQ</TH>
                <TH className="text-right">MOM</TH>
                <TH className="text-right">AGE</TH>
                <TH className="text-right">SCORE</TH>
                <TH>CYCLE</TH>
              </TR>
            </THead>
            <TBody>
              {watchlist.map((w, i) => (
                <TR key={`watch-${w.mint}-${i}`} className="animate-slide-in">
                  <TD className="font-semibold">{w.symbol ?? "—"}</TD>
                  <TD className="text-[var(--muted-foreground)]">
                    <MintLink mint={w.mint} />
                  </TD>
                  <TD className="text-right">{w.liquidityUsd != null ? `$${(w.liquidityUsd / 1000).toFixed(1)}K` : "—"}</TD>
                  <TD className="text-right">{w.momentum !== 0 ? `${(w.momentum*100).toFixed(1)}%` : "—"}</TD>
                  <TD className="text-right">{w.pairAgeSec != null ? `${Math.floor(w.pairAgeSec / 60)}m` : "—"}</TD>
                  <TD className="text-right">{w.score}</TD>
                  <TD><Badge variant="outline" className="text-[8px]">CYC {w.cycleCount}</Badge></TD>
                </TR>
              ))}
              {watchlist.length === 0 && (
                <TR>
                  <TD colSpan={7} className="py-6 text-center text-[var(--muted-foreground)] uppercase tracking-[0.16em] text-[10px]">
                    NO TOKENS ON WATCHLIST
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </TabsContent>

        <TabsContent value="history" className="min-h-0 flex-1 overflow-auto pt-0">
          <Table>
            <THead>
              <TR>
                <TH>SYM</TH>
                <TH>MINT</TH>
                <TH className="text-right">SIZE</TH>
                <TH className="text-right">ENTRY</TH>
                <TH className="text-right">CLOSE</TH>
                <TH className="text-right">PnL %</TH>
                <TH className="text-right">PnL <SolIcon className="inline h-3 w-3" /></TH>
                <TH className="text-right">HOLD</TH>
                <TH>REASON</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((h, i) => {
                const up = (h.pnlSol ?? 0) >= 0;
                const hold = h.closedAt ? Math.floor((h.closedAt - h.openedAt) / 1000) : 0;
                return (
                  <TR key={`hist-${h.id}-${i}`}>
                    <TD className="font-semibold">{h.symbol ?? "—"}</TD>
                    <TD className="text-[var(--muted-foreground)]">
                      <MintLink mint={h.mint} />
                    </TD>
                    <TD className="text-right">{fmtSol(h.sizeSol)}</TD>
                    <TD className="text-right">{fmtUsd(h.entryPriceUsd)}</TD>
                    <TD className="text-right">{fmtUsd(h.closePriceUsd)}</TD>
                    <TD className={cn("text-right font-semibold", up ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                      {fmtPct(h.pnlPct)}
                    </TD>
                    <TD className={cn("text-right", up ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                      {up ? "+" : ""}{fmtSol(h.pnlSol)}
                    </TD>
                    <TD className="text-right">{fmtHold(hold)}</TD>
                    <TD className="text-[var(--muted-foreground)] text-[10px] max-w-[200px] truncate">{h.reason ?? "—"}</TD>
                  </TR>
                );
              })}
              {history.length === 0 && (
                <TR>
                  <TD
                    colSpan={9}
                    className="py-6 text-center text-[var(--muted-foreground)] uppercase tracking-[0.16em] text-[10px]"
                  >
                    NO CLOSED POSITIONS YET
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </TabsContent>
      </Tabs>

      <CardFooter>
        <span>MIRROR + AUTO-SL/TP</span>
        <span>UPDATES VIA SOCKET.IO</span>
      </CardFooter>
    </Card>
  );
}
