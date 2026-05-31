"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AgentState,
  ExecutionMode,
  ScreeningPreset,
} from "@anton/shared-types";

export interface UIState {
  /* Trading config (persisted) */
  mode: ExecutionMode;
  minSpendSol: number;
  maxSpendSol: number;
  maxConcurrent: number;
  dailyLossCapSol: number;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  screeningPreset: ScreeningPreset;

  /* Ephemeral UI state (not persisted) */
  selectedMint: string | null;
  status: AgentState;
  uptimeSec: number;
  solBalance: number;

  setMode: (mode: ExecutionMode) => void;
  setSpend: (minSpendSol: number, maxSpendSol: number) => void;
  setRisk: (next: Partial<UIState>) => void;
  setSelectedMint: (mint: string | null) => void;
  setStatus: (state: AgentState, uptimeSec?: number) => void;
  setSolBalance: (sol: number) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      mode: "dry-run",
      minSpendSol: 0.1,
      maxSpendSol: 0.5,
      maxConcurrent: 5,
      dailyLossCapSol: 2,
      defaultStopLossPct: 12,
      defaultTakeProfitPct: 35,
      screeningPreset: "normal",

      selectedMint: null,
      status: "scanning",
      uptimeSec: 0,
      solBalance: 10,

      setMode: (mode) => set({ mode }),
      setSpend: (minSpendSol, maxSpendSol) =>
        set({ minSpendSol, maxSpendSol }),
      setRisk: (next) => set(next as UIState),
      setSelectedMint: (selectedMint) => set({ selectedMint }),
      setStatus: (status, uptimeSec) =>
        set((s) => ({ status, uptimeSec: uptimeSec ?? s.uptimeSec })),
      setSolBalance: (solBalance) => set({ solBalance }),
    }),
    {
      name: "anton-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        mode: s.mode,
        minSpendSol: s.minSpendSol,
        maxSpendSol: s.maxSpendSol,
        maxConcurrent: s.maxConcurrent,
        dailyLossCapSol: s.dailyLossCapSol,
        defaultStopLossPct: s.defaultStopLossPct,
        defaultTakeProfitPct: s.defaultTakeProfitPct,
        screeningPreset: s.screeningPreset,
      }),
    },
  ),
);
