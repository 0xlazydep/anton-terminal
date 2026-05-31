"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContext {
  value: string;
  setValue: (v: string) => void;
}

const Ctx = React.createContext<TabsContext | null>(null);

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children?: React.ReactNode;
  className?: string;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const v = value ?? internal;
  const setValue = React.useCallback(
    (nv: string) => {
      if (value === undefined) setInternal(nv);
      onValueChange?.(nv);
    },
    [value, onValueChange],
  );
  return (
    <Ctx.Provider value={{ value: v, setValue }}>
      <div className={cn("flex flex-col", className)}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-stretch border-b border-[var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("TabsTrigger must be inside Tabs");
  const active = ctx.value === value;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] transition-colors",
        "border-b border-transparent -mb-px",
        active
          ? "border-foreground text-foreground"
          : "text-[var(--muted-foreground)] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({
  value,
  className,
  ...props
}: TabsContentProps) {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("TabsContent must be inside Tabs");
  if (ctx.value !== value) return null;
  return <div role="tabpanel" className={cn("pt-3", className)} {...props} />;
}
