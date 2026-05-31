"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, fmtPct, fmtSol, isMockMode } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import type {
  HoldingsSnapshotEvent,
  StateSnapshotEvent,
} from "@anton/shared-types";

interface BalancePoint {
  time: number; // unix seconds
  value: number; // SOL
}

/**
 * Synthetic SOL equity curve. Starts near 10 SOL, drifts with small
 * mean-reverting PnL steps every 30s. Deterministic-ish (mirrors mock.ts
 * style without sharing seed state).
 */
function makeBalanceHistory(count = 240): BalancePoint[] {
  const out: BalancePoint[] = [];
  const now = Math.floor(Date.now() / 1000);
  let value = 10;
  for (let i = count - 1; i >= 0; i--) {
    // small drift, slight positive bias
    const drift = (Math.random() - 0.48) * 0.012;
    value = Math.max(value * (1 + drift), 0.0001);
    out.push({ time: now - i * 30, value });
  }
  // Force chronological ascending order
  return out.sort((a, b) => a.time - b.time);
}

export function BalanceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastPoint = useRef<BalancePoint | null>(null);
  const startValueRef = useRef<number | null>(null);
  const [last, setLast] = useState<BalancePoint | null>(null);
  const [startValue, setStartValue] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const isDark =
      document.documentElement.classList.contains("dark") ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    const fg = isDark ? "#fafafa" : "#0a0a0a";
    const grid = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
    const areaTop = isDark ? "rgba(250,250,250,0.22)" : "rgba(10,10,10,0.18)";
    const areaBottom = isDark
      ? "rgba(250,250,250,0.0)"
      : "rgba(10,10,10,0.0)";

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: fg,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      rightPriceScale: {
        borderColor: grid,
        textColor: fg,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: fg,
          width: 1,
          style: 0,
          labelBackgroundColor: fg,
        },
        horzLine: {
          color: fg,
          width: 1,
          style: 0,
          labelBackgroundColor: fg,
        },
      },
      handleScale: true,
      handleScroll: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: fg,
      topColor: areaTop,
      bottomColor: areaBottom,
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });
    seriesRef.current = series;

    if (isMockMode()) {
      const seed = makeBalanceHistory(240);
      series.setData(
        seed.map((p) => ({
          time: p.time as Time,
          value: p.value,
        })),
      );
      const first = seed[0] ?? null;
      const tail = seed[seed.length - 1] ?? null;
      lastPoint.current = tail;
      startValueRef.current = first?.value ?? null;
      setLast(tail);
      setStartValue(first?.value ?? null);

      const tickId = window.setInterval(() => {
        if (!lastPoint.current || !seriesRef.current) return;
        const prev = lastPoint.current;
        const nowSec = Math.floor(Date.now() / 1000);
        // Ensure strictly increasing time; lightweight-charts rejects backwards
        const nextTime = nowSec > prev.time ? nowSec : prev.time + 1;
        const drift = (Math.random() - 0.48) * 0.004;
        const nextValue = Math.max(prev.value * (1 + drift), 0.0001);
        const updated: BalancePoint = { time: nextTime, value: nextValue };
        lastPoint.current = updated;
        seriesRef.current.update({
          time: updated.time as Time,
          value: updated.value,
        });
        setLast(updated);
      }, 1500);

      return () => {
        clearInterval(tickId);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    }

    // Live mode: seed the full persisted curve from state_snapshot (sent on
    // connect), then append live points from holdings_snapshot. Seeding from
    // the persisted history is what makes the curve identical across reloads.
    const sock = getSocket();
    let seedDone = false;

    const onStateSnapshot = (e: StateSnapshotEvent) => {
      if (!seriesRef.current) return;
      startValueRef.current = e.startingSol;
      const points = e.balanceHistory
        .map((p) => ({ time: Math.floor(p.ts / 1000) as Time, value: p.solBalance }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      if (points.length > 0) {
        seriesRef.current.setData(points);
        const tail = points[points.length - 1]!;
        lastPoint.current = { time: tail.time as number, value: tail.value };
        setLast({ time: tail.time as number, value: tail.value });
      }
      seedDone = true;
      setStartValue(e.startingSol);
    };

    const onSnapshot = (e: HoldingsSnapshotEvent) => {
      if (!seriesRef.current) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const point = { time: nowSec as Time, value: e.solBalance };

      if (!seedDone) {
        seriesRef.current.setData([point]);
        startValueRef.current = e.startingSol;
        seedDone = true;
      } else {
        const prev = lastPoint.current;
        if (prev && nowSec <= prev.time) {
          point.time = (prev.time + 1) as Time;
        }
        seriesRef.current.update(point);
      }
      lastPoint.current = { time: nowSec, value: e.solBalance };
      setLast({ time: nowSec, value: e.solBalance });
      setStartValue(startValueRef.current);
    };

    sock.on("state_snapshot", onStateSnapshot);
    sock.on("holdings_snapshot", onSnapshot);

    return () => {
      sock.off("state_snapshot", onStateSnapshot);
      sock.off("holdings_snapshot", onSnapshot);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const delta =
    last !== null && startValue !== null && startValue > 0
      ? ((last.value - startValue) / startValue) * 100
      : 0;
  const up = delta >= 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>BALANCE · SOL</CardTitle>
          <Badge variant="outline">EQUITY CURVE</Badge>
        </div>
        <div className="flex items-center gap-3 tabular-nums">
          <span className="text-xs font-semibold">
            {last ? `${fmtSol(last.value)} SOL` : "—"}
          </span>
          <span
            className={cn(
              "text-[10px] uppercase tracking-[0.14em]",
              up ? "text-[var(--profit)]" : "text-[var(--loss)]",
            )}
          >
            {fmtPct(delta)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative p-0">
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label="SOL balance equity curve"
        />
      </CardContent>
    </Card>
  );
}
