"use client";

import { useRealtime } from "@/hooks/use-realtime";
import { useReasoningStream } from "@/hooks/use-reasoning";

/**
 * Mounts the realtime event subscriptions exactly once at the page root.
 */
export function RealtimeBoot() {
  useRealtime();
  useReasoningStream();
  return null;
}
