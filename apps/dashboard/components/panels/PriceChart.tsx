"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isMockMode, fmtUsd, fmtPct } from "@/lib/utils";
import { makeInitialCandles, nextCandle, type Candle } from "@/lib/mock";

export function PriceChart({ symbol = "PEPE3" }: { symbol?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastCandle = useRef<Candle | null>(null);
  const [last, setLast] = useState<Candle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const isDark =
      document.documentElement.classList.contains("dark") ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    const fg = isDark ? "#fafafa" : "#0a0a0a";
    const grid = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

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
        scaleMargins: { top: 0.05, bottom: 0.05 },
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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: fg,
      downColor: "transparent",
      borderUpColor: fg,
      borderDownColor: fg,
      wickUpColor: fg,
      wickDownColor: fg,
      priceFormat: {
        type: "price",
        precision: 8,
        minMove: 0.00000001,
      },
    });
    seriesRef.current = series;

    if (isMockMode()) {
      const seed = makeInitialCandles(240);
      series.setData(
        seed.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })) as CandlestickData[],
      );
      lastCandle.current = seed[seed.length - 1] ?? null;
      setLast(lastCandle.current);

      const tickId = window.setInterval(() => {
        if (!lastCandle.current || !seriesRef.current) return;
        // Update last bar 4x, then add a new one
        const elapsed = Math.floor(Date.now() / 1000) - lastCandle.current.time;
        if (elapsed >= 30) {
          const nc = nextCandle(lastCandle.current);
          lastCandle.current = nc;
          seriesRef.current.update({
            time: nc.time as Time,
            open: nc.open,
            high: nc.high,
            low: nc.low,
            close: nc.close,
          });
        } else {
          const c = lastCandle.current;
          const drift = (Math.random() - 0.5) * 0.012;
          const close = Math.max(c.close * (1 + drift), 1e-9);
          const updated: Candle = {
            time: c.time,
            open: c.open,
            high: Math.max(c.high, close),
            low: Math.min(c.low, close),
            close,
          };
          lastCandle.current = updated;
          seriesRef.current.update({
            time: updated.time as Time,
            open: updated.open,
            high: updated.high,
            low: updated.low,
            close: updated.close,
          });
        }
        setLast({ ...lastCandle.current });
      }, 750);
      return () => {
        clearInterval(tickId);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const change =
    last !== null ? ((last.close - last.open) / last.open) * 100 : 0;
  const up = change >= 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>PRICE · {symbol}/USD</CardTitle>
          <Badge variant="outline">30S · CANDLES</Badge>
        </div>
        <div className="flex items-center gap-3 tabular-nums">
          <span className="text-xs font-semibold">
            {last ? fmtUsd(last.close) : "—"}
          </span>
          <span
            className={
              up
                ? "text-[10px] uppercase tracking-[0.14em] text-[var(--profit)]"
                : "text-[10px] uppercase tracking-[0.14em] text-[var(--loss)]"
            }
          >
            {fmtPct(change)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative p-0">
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label="Price candlestick chart"
        />
      </CardContent>
    </Card>
  );
}
