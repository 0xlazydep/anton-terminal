import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number to fixed digits with thousands separators, monospace-friendly. */
export function fmtNum(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Format SOL with 4-decimal precision. */
export function fmtSol(n: number | undefined | null): string {
  return fmtNum(n, 4);
}

/** Format USD price; auto sub-cent precision for memes. */
export function fmtUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1) return `$${fmtNum(n, 2)}`;
  if (abs >= 0.01) return `$${fmtNum(n, 4)}`;
  if (abs >= 0.0001) return `$${fmtNum(n, 6)}`;
  return `$${n.toExponential(2)}`;
}

/** Format USD market cap compact (K/M), trailing zeros trimmed. */
export function fmtMc(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.?0+$/, "")}K`;
  return `$${Math.round(n)}`;
}

/** Signed pct with sign char. */
export function fmtPct(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n, digits)}%`;
}

/** Truncate mint for display. */
export function fmtMint(mint: string, head = 4, tail = 4): string {
  if (!mint) return "";
  if (mint.length <= head + tail + 1) return mint;
  return `${mint.slice(0, head)}…${mint.slice(-tail)}`;
}

/** Seconds → mm:ss / hh:mm:ss compact. */
export function fmtHold(sec: number | undefined | null): string {
  if (sec === undefined || sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(r)}`;
  return `${pad(m)}:${pad(r)}`;
}

/** HH:MM:SS.mmm formatted timestamp. */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/** Whether mock data should be used (default ON unless explicitly disabled). */
export function isMockMode(): boolean {
  const flag = process.env.NEXT_PUBLIC_MOCK;
  if (flag === "0" || flag === "false") return false;
  return true;
}
