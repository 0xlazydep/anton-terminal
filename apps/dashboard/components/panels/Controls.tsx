"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LabeledInput } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useUI } from "@/store/ui";
import { getSocket } from "@/lib/socket";
import { cn, isMockMode } from "@/lib/utils";
import type {
  ExecutionMode,
  ScreeningPreset,
  SetModeEvent,
  SetSpendLimitsEvent,
} from "@anton/shared-types";

const PRESETS: { value: ScreeningPreset; label: string }[] = [
  { value: "strict", label: "STRICT" },
  { value: "normal", label: "NORMAL" },
  { value: "relaxed", label: "RELAXED" },
];

export function Controls() {
  const {
    mode,
    minSpendSol,
    maxSpendSol,
    maxConcurrent,
    dailyLossCapSol,
    defaultStopLossPct,
    defaultTakeProfitPct,
    screeningPreset,
    setMode,
    setSpend,
    setRisk,
  } = useUI();

  const [confirmingLive, setConfirmingLive] = useState(false);

  const emit = (event: string, payload: unknown) => {
    if (!isMockMode()) {
      try {
        getSocket().emit(event, payload);
      } catch {
        // No-op in mock mode or when offline
      }
    }
    // In mock mode, just no-op. Could console.debug for dev visibility.
  };

  const onToggleMode = (next: boolean) => {
    const target: ExecutionMode = next ? "live" : "dry-run";
    if (target === "live") {
      setConfirmingLive(true);
      return;
    }
    setMode("dry-run");
    const payload: SetModeEvent = { mode: "dry-run" };
    emit("set_mode", payload);
  };

  const confirmLive = () => {
    setMode("live");
    setConfirmingLive(false);
    const payload: SetModeEvent = { mode: "live" };
    emit("set_mode", payload);
  };

  const onSpendChange = (
    key: "minSpendSol" | "maxSpendSol",
    raw: string,
  ) => {
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0) return;
    const next = {
      minSpendSol: key === "minSpendSol" ? v : minSpendSol,
      maxSpendSol: key === "maxSpendSol" ? v : maxSpendSol,
    };
    setSpend(next.minSpendSol, next.maxSpendSol);
    const payload: SetSpendLimitsEvent = {
      minSol: next.minSpendSol,
      maxSol: next.maxSpendSol,
    };
    emit("set_spend_limits", payload);
  };

  const onEmergency = () => {
    emit("emergency_stop", {});
    setMode("dry-run");
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>CONTROLS</CardTitle>
          <Badge variant={mode === "live" ? "loss" : "outline"}>
            MODE · {mode === "live" ? "LIVE" : "DRY-RUN"}
          </Badge>
        </div>
        <span className="label-mono">OPERATOR → AGENT</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* MODE TOGGLE */}
        <div className="flex items-center justify-between border border-[var(--border)] p-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              EXECUTION MODE
            </span>
            <span
              className={cn(
                "text-sm font-semibold uppercase tracking-[0.18em]",
                mode === "live"
                  ? "text-[var(--loss)]"
                  : "text-foreground",
              )}
            >
              {mode === "live" ? "LIVE · REAL FUNDS" : "DRY-RUN · SIMULATED"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="label-mono">DRY</span>
            <Switch
              checked={mode === "live"}
              onCheckedChange={onToggleMode}
              aria-label="Toggle execution mode"
            />
            <span className="label-mono">LIVE</span>
          </div>
        </div>

        {confirmingLive && (
          <div className="border border-[var(--loss)] bg-[var(--loss)]/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--loss)] mb-2">
              ⚠ CONFIRM LIVE TRADING
            </p>
            <p className="text-[10px] text-foreground/80 mb-3 leading-relaxed">
              Real SOL will be spent. Anton will execute trades up to{" "}
              <span className="font-semibold">{maxSpendSol} SOL</span> per
              position, capped at <span className="font-semibold">{dailyLossCapSol} SOL</span>{" "}
              daily loss. Continue?
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={confirmLive}
              >
                CONFIRM LIVE
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingLive(false)}
              >
                CANCEL
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* SPEND */}
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput
            label="MIN SPEND"
            type="number"
            step="0.01"
            min={0}
            unit="SOL"
            value={minSpendSol}
            onChange={(e) => onSpendChange("minSpendSol", e.target.value)}
          />
          <LabeledInput
            label="MAX SPEND"
            type="number"
            step="0.01"
            min={0}
            unit="SOL"
            value={maxSpendSol}
            onChange={(e) => onSpendChange("maxSpendSol", e.target.value)}
          />
        </div>

        <Separator />

        {/* RISK */}
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput
            label="MAX CONCURRENT"
            type="number"
            min={1}
            value={maxConcurrent}
            onChange={(e) =>
              setRisk({ maxConcurrent: Math.max(1, Number(e.target.value)) })
            }
          />
          <LabeledInput
            label="DAILY LOSS CAP"
            type="number"
            step="0.1"
            min={0}
            unit="SOL"
            value={dailyLossCapSol}
            onChange={(e) =>
              setRisk({ dailyLossCapSol: Math.max(0, Number(e.target.value)) })
            }
          />
          <LabeledInput
            label="DEFAULT SL"
            type="number"
            min={1}
            unit="%"
            value={defaultStopLossPct}
            onChange={(e) =>
              setRisk({ defaultStopLossPct: Math.max(1, Number(e.target.value)) })
            }
          />
          <LabeledInput
            label="DEFAULT TP"
            type="number"
            min={1}
            unit="%"
            value={defaultTakeProfitPct}
            onChange={(e) =>
              setRisk({ defaultTakeProfitPct: Math.max(1, Number(e.target.value)) })
            }
          />
        </div>

        {/* SCREENING PRESET */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            SCREENING PRESET
          </span>
          <div className="grid grid-cols-3 gap-0 border border-[var(--border)]">
            {PRESETS.map((p, idx) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setRisk({ screeningPreset: p.value })}
                className={cn(
                  "h-8 text-[10px] font-medium uppercase tracking-[0.18em] transition-colors",
                  idx > 0 && "border-l border-[var(--border)]",
                  screeningPreset === p.value
                    ? "bg-foreground text-background"
                    : "bg-transparent text-foreground hover:bg-foreground/10",
                )}
                aria-pressed={screeningPreset === p.value}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <span>HARD CAPS ENFORCED SERVER-SIDE</span>
        <Button
          variant="danger"
          size="sm"
          onClick={onEmergency}
          aria-label="Emergency stop all trading"
        >
          ⚠ EMERGENCY STOP
        </Button>
      </CardFooter>
    </Card>
  );
}
