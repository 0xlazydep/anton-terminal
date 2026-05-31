"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-8 w-full border border-[var(--border)] bg-background px-2 py-1 text-[11px] tabular-nums text-foreground placeholder:text-[var(--muted-foreground)] placeholder:uppercase placeholder:tracking-[0.14em]",
        "focus-visible:border-foreground focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export interface LabeledInputProps extends InputProps {
  label: string;
  hint?: string;
  unit?: string;
}

export function LabeledInput({
  label,
  hint,
  unit,
  className,
  id,
  ...props
}: LabeledInputProps) {
  const inputId =
    id ?? `i-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={inputId}
        className="text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]"
      >
        {label}
      </label>
      <div className="relative">
        <Input id={inputId} {...props} />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          {hint}
        </p>
      )}
    </div>
  );
}
