/** Server-Sent Events helpers for the agent reasoning stream. */

import { CHANNELS } from "@anton/shared-types";
import type {
  ReasoningStepEvent,
  EntryDecisionEvent,
  AlertEvent,
} from "@anton/shared-types";
import type { EventBus } from "./bus.js";

export type SseEventName = "reasoning_step" | "entry_decision" | "alert";

export interface SsePayload {
  event: SseEventName;
  data: ReasoningStepEvent | EntryDecisionEvent | AlertEvent;
}

/** Formats a single SSE frame. */
export function formatSseFrame(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("", "");
  return lines.join("\n");
}

/** Keep-alive comment frame to defeat proxy timeouts. */
export const SSE_KEEPALIVE = ": keepalive\n\n";

/**
 * Bridges the reasoning bus channel to an SSE sink (write callback). Returns an
 * unsubscribe/cleanup function. Framework-agnostic: pass a `write` that sends a
 * string chunk to the client, and call the returned cleanup on disconnect.
 */
export function createReasoningSseBridge(
  bus: EventBus,
  write: (chunk: string) => void,
  keepAliveMs = 25_000,
): () => void {
  void bus.subscribe(CHANNELS.reasoning, (payload: unknown) => {
    const evt = payload as { type: SseEventName; data: unknown };
    if (evt?.type) write(formatSseFrame(evt.type, evt.data));
  });

  const timer = setInterval(() => write(SSE_KEEPALIVE), keepAliveMs);

  return () => {
    clearInterval(timer);
  };
}
