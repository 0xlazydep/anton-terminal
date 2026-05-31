import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "solid" | "profit" | "loss" | "warn";

const map: Record<Variant, string> = {
  default:
    "border border-[var(--border)] bg-transparent text-foreground",
  outline:
    "border border-foreground/40 bg-transparent text-foreground",
  solid: "border border-foreground bg-foreground text-background",
  profit:
    "border border-[var(--profit)] bg-transparent text-[var(--profit)]",
  loss: "border border-[var(--loss)] bg-transparent text-[var(--loss)]",
  warn: "border border-foreground/60 bg-transparent text-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em]",
        map[variant],
        className,
      )}
      {...props}
    />
  );
}
