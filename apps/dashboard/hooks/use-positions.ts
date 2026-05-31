"use client";

import { useQuery } from "@tanstack/react-query";
import type { MockPosition } from "@/lib/mock";

export interface ClosedPosition extends MockPosition {
  closePriceUsd: number;
  reason: string;
  closedAt: number;
}

export function usePositions(): {
  positions: MockPosition[];
  totalPnlSol: number;
  totalPnlPct: number;
} {
  const { data } = useQuery<MockPosition[]>({
    queryKey: ["positions"],
    initialData: [],
    queryFn: async () => [],
  });
  const positions = data ?? [];
  const totalPnlSol = positions.reduce((acc, p) => acc + (p.pnlSol ?? 0), 0);
  const totalSize = positions.reduce((acc, p) => acc + (p.sizeSol ?? 0), 0);
  const totalPnlPct = totalSize > 0 ? (totalPnlSol / totalSize) * 100 : 0;
  return { positions, totalPnlSol, totalPnlPct };
}

export function usePositionHistory(): ClosedPosition[] {
  const { data } = useQuery<ClosedPosition[]>({
    queryKey: ["position-history"],
    initialData: [],
    queryFn: async () => [],
  });
  return data ?? [];
}

export function useRealizedPnl(): {
  realizedPnlSol: number;
  realizedPnlPct: number;
  closedCount: number;
} {
  const history = usePositionHistory();
  const realizedPnlSol = history.reduce((acc, p) => acc + (p.pnlSol ?? 0), 0);
  const totalSize = history.reduce((acc, p) => acc + (p.sizeSol ?? 0), 0);
  const realizedPnlPct = totalSize > 0 ? (realizedPnlSol / totalSize) * 100 : 0;
  return { realizedPnlSol, realizedPnlPct, closedCount: history.length };
}
