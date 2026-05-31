import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex flex-col border border-[var(--border)] bg-[var(--card)] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: keyof React.JSX.IntrinsicElements;
}

export function CardTitle({
  className,
  as: Tag = "h3",
  ...props
}: CardTitleProps) {
  const Component = Tag as React.ElementType;
  return (
    <Component
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 p-3", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]",
        className,
      )}
      {...props}
    />
  );
}
