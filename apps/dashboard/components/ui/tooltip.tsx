"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * Minimal CSS-only tooltip (no Radix). Triggers on hover/focus.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap border border-[var(--border)] bg-background px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
