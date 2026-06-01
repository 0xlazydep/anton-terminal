"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AgentStatusEvent,
  HoldingsSnapshotEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
  PositionClosedEvent,
  ScreeningResultEvent,
  StateSnapshotEvent,
  WalletEnteredEvent,
  WalletExitedEvent,
} from "@anton/shared-types";
import { useUI } from "@/store/ui";
import { getSocket } from "@/lib/socket";
import { isMockMode } from "@/lib/utils";
import type { ClosedPosition } from "@/hooks/use-positions";
import {
  getInitialPositions,
  makeScreeningRow,
  makeWalletEvent,
  nextAgentStatus,
  tickPositions,
  type MockPosition,
  type MockScreeningRow,
  type SmartWalletEvent,
} from "@/lib/mock";

/**
 * Single mount point that wires Socket.IO events into the TanStack Query cache.
 * In mock mode (default in dev), it synthesizes a continuous stream of events.
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  const setStatus = useUI((s) => s.setStatus);
  const setSolBalance = useUI((s) => s.setSolBalance);
  const setMode = useUI((s) => s.setMode);

  useEffect(() => {
    if (isMockMode()) {
      // Seed initial caches.
      qc.setQueryData<MockPosition[]>(["positions"], getInitialPositions());
      qc.setQueryData<MockScreeningRow[]>(
        ["screening"],
        Array.from({ length: 6 }, () => makeScreeningRow()),
      );
      qc.setQueryData<SmartWalletEvent[]>(
        ["smart-wallets"],
        Array.from({ length: 8 }, () => makeWalletEvent()),
      );

      const tickId = window.setInterval(() => {
        // Position prices tick every 1.2s
        qc.setQueryData<MockPosition[]>(["positions"], (prev) => {
          if (!prev || prev.length === 0) return prev;
          return tickPositions(prev).positions;
        });
      }, 1200);

      const lifecycleId = window.setInterval(() => {
        const now = Date.now();
        const CLOSE_REASONS = [
          "TP hit at +35% · auto close",
          "SL triggered at -12% · position flattened",
          "Smart-wallet W-exit detected · mirror exit",
          "Manual exit · operator closed position",
          "Time-based exit · hold exceeded 4h",
          "Volatility spike · exited for safety",
        ];

        qc.setQueryData<MockPosition[]>(["positions"], (prev) => {
          if (!prev || prev.length === 0) return prev;
          const remaining = [...prev];
          const closed: ClosedPosition[] = [];

          const closable = remaining
            .map((p, idx) => ({ p, idx }))
            .filter(({ p }) => now - p.openedAt > 30_000)
            .sort((a, b) => a.p.openedAt - b.p.openedAt);

          const closeCount = Math.min(closable.length, Math.random() > 0.5 ? 2 : 1);
          for (let i = 0; i < closeCount; i++) {
            const { p, idx } = closable[i]!;
            const reason = CLOSE_REASONS[Math.floor(Math.random() * CLOSE_REASONS.length)]!;
            closed.push({
              ...p,
              closePriceUsd: p.currentPriceUsd,
              reason,
              closedAt: now,
            });
            remaining.splice(idx - i, 1);
          }

          if (closed.length > 0) {
            qc.setQueryData<ClosedPosition[]>(["position-history"], (h) =>
              [...closed, ...(h ?? [])].slice(0, 100),
            );
          }

          const openCount = Math.min(2, Math.floor(Math.random() * 2) + 1);
          const SYMBOLS = [
            "PEPE3", "WIFHAT", "BONK2", "MYRO", "POPCAT", "MOTHER",
            "GIGA", "PNUT", "GOAT", "CHILLGUY",
          ];
          const randBetween = (min: number, max: number) =>
            min + (max - min) * Math.random();
          const makeMint = () => {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
            let s = "";
            for (let j = 0; j < 44; j++) s += chars[Math.floor(Math.random() * chars.length)];
            return s;
          };

          for (let i = 0; i < openCount; i++) {
            const entryPriceUsd = randBetween(0.00002, 0.012);
            const driftPct = randBetween(-18, 42);
            const sizeSol = randBetween(0.08, 0.42);
            const currentPriceUsd = entryPriceUsd * (1 + driftPct / 100);
            const pnlSol = sizeSol * (driftPct / 100);
            const entryMc = randBetween(20_000, 400_000);
            const currentMc = entryMc * (1 + driftPct / 100);
            remaining.push({
              id: `pos_new_${Date.now()}_${i}`,
              mint: makeMint(),
              symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
              entryPriceUsd,
              entryMarketCapUsd: entryMc,
              sizeSol,
              mode: Math.random() > 0.2 ? "dry-run" : "live",
              currentPriceUsd,
              currentMarketCapUsd: currentMc,
              pnlPct: driftPct,
              pnlSol,
              slPct: 12,
              tpPct: 35,
              openedAt: now,
            });
          }

          return remaining;
        });
      }, 10_000);

      const screenId = window.setInterval(() => {
        qc.setQueryData<MockScreeningRow[]>(["screening"], (prev) => {
          const next = [makeScreeningRow(), ...(prev ?? [])];
          return next.slice(0, 40);
        });
      }, 3200);

      const walletId = window.setInterval(() => {
        qc.setQueryData<SmartWalletEvent[]>(["smart-wallets"], (prev) => {
          const next = [makeWalletEvent(), ...(prev ?? [])];
          return next.slice(0, 60);
        });
      }, 1800);

      const statusId = window.setInterval(() => {
        const s = nextAgentStatus();
        setStatus(s.state, s.uptimeSec);
      }, 4500);

      return () => {
        clearInterval(tickId);
        clearInterval(lifecycleId);
        clearInterval(screenId);
        clearInterval(walletId);
        clearInterval(statusId);
      };
    }

    // ───── Real Socket.IO wiring (when NEXT_PUBLIC_MOCK=0) ─────
    const socket = getSocket();

    const onOpened = (evt: PositionOpenedEvent) => {
      qc.setQueryData<MockPosition[]>(["positions"], (prev) => {
        // Dedup by id — the server may re-emit opened snapshots so late-joining
        // clients still receive the current open positions.
        if (prev?.some((p) => p.id === evt.id)) return prev;
        const seeded: MockPosition = {
          ...evt,
          currentPriceUsd: evt.entryPriceUsd,
          currentMarketCapUsd: evt.entryMarketCapUsd,
          pnlPct: 0,
          pnlSol: 0,
          slPct: 0,
          tpPct: 0,
          openedAt: Date.now(),
        };
        return [seeded, ...(prev ?? [])];
      });
    };

    const onUpdate = (evt: PositionUpdateEvent) => {
      qc.setQueryData<MockPosition[]>(["positions"], (prev) => {
        if (!prev) return prev;
        return prev.map((p) =>
          p.id === evt.id
            ? {
                ...p,
                currentPriceUsd: evt.currentPriceUsd,
                currentMarketCapUsd: evt.currentMarketCapUsd ?? p.currentMarketCapUsd,
                pnlPct: evt.pnlPct,
                pnlSol: p.sizeSol * (evt.pnlPct / 100),
                slPct: evt.slPct ?? p.slPct,
                tpPct: evt.tpPct ?? p.tpPct,
              }
            : p,
        );
      });
    };

    const onClosed = (evt: PositionClosedEvent) => {
      qc.setQueryData<MockPosition[]>(["positions"], (prev) => {
        const closed = (prev ?? []).find((p) => p.id === evt.id);
        if (closed) {
          qc.setQueryData<ClosedPosition[]>(["position-history"], (h) =>
            [{ ...closed, ...evt, closedAt: Date.now() }, ...(h ?? [])].slice(0, 100),
          );
        }
        return (prev ?? []).filter((p) => p.id !== evt.id);
      });
    };

    const onScreening = (evt: ScreeningResultEvent) => {
      qc.setQueryData<ScreeningResultEvent[]>(["screening"], (prev) => {
        const existing = (prev ?? []).find((r) => r.mint === evt.mint);
        if (existing && evt.llmAction) {
          // Merge LLM decision into existing screening row
          return (prev ?? []).map((r) =>
            r.mint === evt.mint ? { ...r, llmAction: evt.llmAction } : r,
          );
        }
        const withoutMint = (prev ?? []).filter((r) => r.mint !== evt.mint);
        return [evt, ...withoutMint].slice(0, 40);
      });
    };

    const onWalletEnter = (evt: WalletEnteredEvent) => {
      qc.setQueryData<SmartWalletEvent[]>(["smart-wallets"], (prev) => {
        const item: SmartWalletEvent = { kind: "entered", ...evt };
        return [item, ...(prev ?? [])].slice(0, 60);
      });
    };

    const onWalletExit = (evt: WalletExitedEvent) => {
      qc.setQueryData<SmartWalletEvent[]>(["smart-wallets"], (prev) => {
        const item: SmartWalletEvent = { kind: "exited", ...evt };
        return [item, ...(prev ?? [])].slice(0, 60);
      });
    };

    const onAgentStatus = (evt: AgentStatusEvent) => {
      setStatus(evt.state, evt.uptimeSec);
    };

    const onHoldingsSnapshot = (evt: HoldingsSnapshotEvent) => {
      setSolBalance(evt.solBalance);
    };

    const onStateSnapshot = (evt: StateSnapshotEvent) => {
      qc.setQueryData<MockPosition[]>(["positions"], evt.positions as MockPosition[]);
      qc.setQueryData<ClosedPosition[]>(
        ["position-history"],
        evt.history as ClosedPosition[],
      );
      if (evt.mode) setMode(evt.mode);
      if (evt.recentLessons) {
        qc.setQueryData(["recent-lessons"], evt.recentLessons);
      }
      if (evt.patternStats) {
        qc.setQueryData(["pattern-stats"], evt.patternStats);
      }
    };

    socket.on("state_snapshot", onStateSnapshot);
    socket.on("position_opened", onOpened);
    socket.on("position_update", onUpdate);
    socket.on("position_closed", onClosed);
    socket.on("screening_result", onScreening);
    socket.on("wallet_entered", onWalletEnter);
    socket.on("wallet_exited", onWalletExit);
    socket.on("agent_status", onAgentStatus);
    socket.on("holdings_snapshot", onHoldingsSnapshot);

    return () => {
      socket.off("state_snapshot", onStateSnapshot);
      socket.off("position_opened", onOpened);
      socket.off("position_update", onUpdate);
      socket.off("position_closed", onClosed);
      socket.off("screening_result", onScreening);
      socket.off("wallet_entered", onWalletEnter);
      socket.off("wallet_exited", onWalletExit);
      socket.off("agent_status", onAgentStatus);
      socket.off("holdings_snapshot", onHoldingsSnapshot);
    };
  }, [qc, setStatus, setSolBalance]);
}
