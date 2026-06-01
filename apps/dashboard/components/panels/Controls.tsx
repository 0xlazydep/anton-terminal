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

interface DraftConfig {
  mode: ExecutionMode;
  minSpendSol: number;
  maxSpendSol: number;
  maxConcurrent: number;
  dailyLossCapSol: number;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  screeningPreset: ScreeningPreset;
}

function configEqual(a: DraftConfig, b: DraftConfig): boolean {
  return (
    a.mode === b.mode &&
    a.minSpendSol === b.minSpendSol &&
    a.maxSpendSol === b.maxSpendSol &&
    a.maxConcurrent === b.maxConcurrent &&
    a.dailyLossCapSol === b.dailyLossCapSol &&
    a.defaultStopLossPct === b.defaultStopLossPct &&
    a.defaultTakeProfitPct === b.defaultTakeProfitPct &&
    a.screeningPreset === b.screeningPreset
  );
}

export function Controls() {
  const store = useUI();

  const [draft, setDraft] = useState<DraftConfig>({
    mode: store.mode,
    minSpendSol: store.minSpendSol,
    maxSpendSol: store.maxSpendSol,
    maxConcurrent: store.maxConcurrent,
    dailyLossCapSol: store.dailyLossCapSol,
    defaultStopLossPct: store.defaultStopLossPct,
    defaultTakeProfitPct: store.defaultTakeProfitPct,
    screeningPreset: store.screeningPreset,
  });

  const synced = configEqual(draft, {
    mode: store.mode,
    minSpendSol: store.minSpendSol,
    maxSpendSol: store.maxSpendSol,
    maxConcurrent: store.maxConcurrent,
    dailyLossCapSol: store.dailyLossCapSol,
    defaultStopLossPct: store.defaultStopLossPct,
    defaultTakeProfitPct: store.defaultTakeProfitPct,
    screeningPreset: store.screeningPreset,
  });

  const [confirmingLive, setConfirmingLive] = useState(false);

  const emit = (event: string, payload: unknown) => {
    if (!isMockMode()) {
      try {
        getSocket().emit(event, payload);
      } catch {
        // No-op in mock mode or when offline
      }
    }
  };

  const onToggleMode = (next: boolean) => {
    const target: ExecutionMode = next ? "live" : "dry-run";
    if (target === "live") {
      setConfirmingLive(true);
      return;
    }
    store.setMode("dry-run");
    const payload: SetModeEvent = { mode: "dry-run" };
    emit("set_mode", payload);
  };

  const confirmLive = () => {
    store.setMode("live");
    setConfirmingLive(false);
    const payload: SetModeEvent = { mode: "live" };
    emit("set_mode", payload);
  };

  const onApplyConfig = () => {
    store.applyConfig({ ...draft, mode: store.mode });
    const spendPayload: SetSpendLimitsEvent = {
      minSol: draft.minSpendSol,
      maxSol: draft.maxSpendSol,
    };
    emit("set_spend_limits", spendPayload);
    emit("set_risk_config", {
      maxConcurrent: draft.maxConcurrent,
      dailyLossCapSol: draft.dailyLossCapSol,
      defaultStopLossPct: draft.defaultStopLossPct,
      defaultTakeProfitPct: draft.defaultTakeProfitPct,
      screeningPreset: draft.screeningPreset,
    });
  };

  const onRevert = () => {
    setDraft({
      mode: store.mode,
      minSpendSol: store.minSpendSol,
      maxSpendSol: store.maxSpendSol,
      maxConcurrent: store.maxConcurrent,
      dailyLossCapSol: store.dailyLossCapSol,
      defaultStopLossPct: store.defaultStopLossPct,
      defaultTakeProfitPct: store.defaultTakeProfitPct,
      screeningPreset: store.screeningPreset,
    });
  };

  const updateDraft = (patch: Partial<DraftConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const onEmergency = () => {
    emit("emergency_stop", {});
    store.setMode("dry-run");
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>CONTROLS</CardTitle>
          <Badge variant={store.mode === "live" ? "loss" : "outline"}>
            MODE · {store.mode === "live" ? "LIVE" : "DRY-RUN"}
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
                store.mode === "live"
                  ? "text-[var(--loss)]"
                  : "text-foreground",
              )}
            >
              {store.mode === "live" ? "LIVE · REAL FUNDS" : "DRY-RUN · SIMULATED"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="label-mono">DRY</span>
            <Switch
              checked={store.mode === "live"}
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
              <span className="font-semibold">{draft.maxSpendSol} SOL</span> per
              position, capped at <span className="font-semibold">{draft.dailyLossCapSol} SOL</span>{" "}
              daily loss. Continue?
            </p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={confirmLive}>
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
            value={draft.minSpendSol}
            onChange={(e) => updateDraft({ minSpendSol: Number(e.target.value) || 0 })}
          />
          <LabeledInput
            label="MAX SPEND"
            type="number"
            step="0.01"
            min={0}
            unit="SOL"
            value={draft.maxSpendSol}
            onChange={(e) => updateDraft({ maxSpendSol: Number(e.target.value) || 0 })}
          />
        </div>

        <Separator />

        {/* RISK */}
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput
            label="MAX CONCURRENT"
            type="number"
            min={1}
            value={draft.maxConcurrent}
            onChange={(e) =>
              updateDraft({ maxConcurrent: Math.max(1, Number(e.target.value) || 1) })
            }
          />
          <LabeledInput
            label="DAILY LOSS CAP"
            type="number"
            step="0.1"
            min={0}
            unit="SOL"
            value={draft.dailyLossCapSol}
            onChange={(e) =>
              updateDraft({ dailyLossCapSol: Math.max(0, Number(e.target.value) || 0) })
            }
          />
          <LabeledInput
            label="DEFAULT SL"
            type="number"
            min={1}
            unit="%"
            value={draft.defaultStopLossPct}
            onChange={(e) =>
              updateDraft({ defaultStopLossPct: Math.max(1, Number(e.target.value) || 1) })
            }
          />
          <LabeledInput
            label="DEFAULT TP"
            type="number"
            min={1}
            unit="%"
            value={draft.defaultTakeProfitPct}
            onChange={(e) =>
              updateDraft({ defaultTakeProfitPct: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </div>

        {/* SCREENING PRESET */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            SCREENING PRESET
          </span>
          <div className="grid grid-cols-3 gap-0 border border-[var(--border)]">
            {PRESETS.map((p, idx) => {
              const active = draft.screeningPreset === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => updateDraft({ screeningPreset: p.value })}
                  className={cn(
                    "h-8 text-[10px] font-medium uppercase tracking-[0.18em] transition-colors",
                    idx > 0 && "border-l border-[var(--border)]",
                    active
                      ? "bg-foreground text-background"
                      : "bg-transparent text-foreground hover:bg-foreground/10",
                  )}
                  aria-pressed={active}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2">
        <span className={cn("label-mono", !synced && "text-[var(--warning)]")}>
          {synced ? "CONFIG SYNCED" : "UNSAVED CHANGES"}
        </span>
        <div className="flex items-center gap-2">
          {!synced && (
            <>
              <Button variant="ghost" size="sm" onClick={onRevert}>
                REVERT
              </Button>
              <Button variant="success" size="sm" onClick={onApplyConfig}>
                APPLY CONFIG
              </Button>
            </>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={onEmergency}
            aria-label="Emergency stop all trading"
          >
            ⚠ EMERGENCY STOP
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
