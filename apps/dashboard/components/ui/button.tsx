"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "ghost" | "outline" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  default:
    "bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80 border border-foreground",
  ghost:
    "bg-transparent text-foreground hover:bg-foreground/10 border border-transparent",
  outline:
    "bg-transparent text-foreground hover:bg-foreground/5 border border-foreground/40 hover:border-foreground",
  danger:
    "bg-transparent text-[var(--loss)] border border-[var(--loss)] hover:bg-[var(--loss)] hover:text-background",
  success:
    "bg-transparent text-[var(--profit)] border border-[var(--profit)] hover:bg-[var(--profit)] hover:text-background",
};

const sizeClass: Record<Size, string> = {
  sm: "h-7 px-2 text-[10px]",
  md: "h-9 px-3 text-[11px]",
  lg: "h-11 px-4 text-xs",
  icon: "h-8 w-8",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium uppercase tracking-[0.14em] transition-colors",
        "focus-visible:outline-1 focus-visible:outline focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
