"use client";

import { cn, fmtMint } from "@/lib/utils";

export interface MintLinkProps {
  mint: string;
  kind?: "token" | "wallet";
  className?: string;
}

/**
 * External link to DexScreener (token) or Solscan (wallet).
 * Renders truncated mint via fmtMint; full mint exposed via `title`.
 */
export function MintLink({ mint, kind = "token", className }: MintLinkProps) {
  const href =
    kind === "wallet"
      ? `https://solscan.io/account/${mint}`
      : `https://dexscreener.com/solana/${mint}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={mint}
      className={cn(
        "hover:underline hover:text-[var(--foreground)] transition-colors",
        className,
      )}
    >
      {fmtMint(mint)}
    </a>
  );
}
