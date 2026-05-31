"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EntryDecisionEvent,
  ReasoningStepEvent,
} from "@anton/shared-types";
import { isMockMode } from "@/lib/utils";
import { makeDecision, makeReasoningStep } from "@/lib/mock";
import { useEventSource } from "@/lib/sse";

export type ReasoningEntry =
  | { kind: "step"; data: ReasoningStepEvent }
  | { kind: "decision"; data: EntryDecisionEvent; ts: number };

const MAX_LOG = 500;

export function useReasoningStream(): void {
  const qc = useQueryClient();
  const mock = isMockMode();

  useEffect(() => {
    if (!mock) return;
    let step = 0;
    // Seed initial entries
    qc.setQueryData<ReasoningEntry[]>(["reasoning"], () => {
      const seeded: ReasoningEntry[] = [];
      for (let i = 0; i < 18; i++) {
        const s = makeReasoningStep(step);
        step = s.step;
        seeded.push({ kind: "step", data: s });
      }
      return seeded;
    });

    const stepId = window.setInterval(() => {
      qc.setQueryData<ReasoningEntry[]>(["reasoning"], (prev) => {
        const s = makeReasoningStep(step);
        step = s.step;
        const next: ReasoningEntry[] = [
          ...(prev ?? []),
          { kind: "step", data: s },
        ];
        return next.slice(-MAX_LOG);
      });
    }, 1400);

    const decisionId = window.setInterval(() => {
      qc.setQueryData<ReasoningEntry[]>(["reasoning"], (prev) => {
        const d = makeDecision();
        const next: ReasoningEntry[] = [
          ...(prev ?? []),
          { kind: "decision", data: d, ts: Date.now() },
        ];
        return next.slice(-MAX_LOG);
      });
    }, 7200);

    return () => {
      clearInterval(stepId);
      clearInterval(decisionId);
    };
  }, [mock, qc]);

  // Live SSE wiring (no-op in mock mode)
  useEventSource(
    "/api/agent/stream",
    (name, data) => {
      if (name === "reasoning_step") {
        qc.setQueryData<ReasoningEntry[]>(["reasoning"], (prev) =>
          [
            ...(prev ?? []),
            { kind: "step" as const, data: data as ReasoningStepEvent },
          ].slice(-MAX_LOG),
        );
      } else if (name === "entry_decision") {
        qc.setQueryData<ReasoningEntry[]>(["reasoning"], (prev) =>
          [
            ...(prev ?? []),
            {
              kind: "decision" as const,
              data: data as EntryDecisionEvent,
              ts: Date.now(),
            },
          ].slice(-MAX_LOG),
        );
      }
    },
    !mock,
  );
}

export function useReasoningEntries(): ReasoningEntry[] {
  const { data } = useQuery<ReasoningEntry[]>({
    queryKey: ["reasoning"],
    initialData: [],
    queryFn: async () => [],
  });
  return data ?? [];
}
