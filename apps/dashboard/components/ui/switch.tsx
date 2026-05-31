"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-10 shrink-0 border border-foreground bg-background transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-foreground" : "bg-background",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 h-3.5 w-3.5 border border-foreground transition-transform",
          checked
            ? "translate-x-[22px] bg-background"
            : "translate-x-0.5 bg-foreground",
        )}
      />
    </button>
  );
}
