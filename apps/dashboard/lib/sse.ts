"use client";

import { useEffect } from "react";

export type SSEHandler = (eventName: string, data: unknown) => void;

/**
 * Subscribe to an SSE stream and dispatch named events.
 * Auto-reconnects via the browser-native EventSource.
 */
export function useEventSource(url: string, handler: SSEHandler, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(url);
    const events = [
      "reasoning_step",
      "entry_decision",
      "dry_run_notice",
      "alert",
    ];
    const listeners = events.map((name) => {
      const fn = (e: MessageEvent) => {
        try {
          handler(name, JSON.parse(e.data));
        } catch {
          handler(name, e.data);
        }
      };
      es.addEventListener(name, fn as EventListener);
      return { name, fn };
    });
    es.onmessage = (e) => {
      try {
        handler("message", JSON.parse(e.data));
      } catch {
        handler("message", e.data);
      }
    };
    return () => {
      for (const { name, fn } of listeners) {
        es.removeEventListener(name, fn as EventListener);
      }
      es.close();
    };
  }, [url, handler, enabled]);
}
