"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MintLink } from "@/components/ui/mint-link";
import { getSocket } from "@/lib/socket";
import { cn, fmtTime, fmtUsd, isMockMode } from "@/lib/utils";
import type { SmartWalletEvent } from "@/lib/mock";
import type { AddWalletEvent } from "@anton/shared-types";

function TrustBar({ trust }: { trust: number }) {
  return (
    <div className="relative h-1 w-12 bg-foreground/10">
      <div
        className="absolute inset-y-0 left-0 bg-foreground"
        style={{ width: `${Math.round(trust * 100)}%` }}
      />
    </div>
  );
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isPlausibleSolanaAddress(s: string): boolean {
  return s.length >= 32 && s.length <= 44 && BASE58_RE.test(s);
}

export function SmartWalletFeed() {
  const qc = useQueryClient();
  const { data } = useQuery<SmartWalletEvent[]>({
    queryKey: ["smart-wallets"],
    initialData: [],
    queryFn: async () => [],
  });
  const events = data ?? [];

  const [walletInput, setWalletInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = walletInput.trim();
    if (!isPlausibleSolanaAddress(value)) {
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 1200);
      return;
    }

    if (!isMockMode()) {
      try {
        const payload: AddWalletEvent = { wallet: value };
        getSocket().emit("add_wallet", payload);
      } catch {
        // socket may be offline; optimistic cache update still happens
      }
    }

    qc.setQueryData<SmartWalletEvent[]>(["smart-wallets"], (prev) =>
      [
        {
          kind: "entered" as const,
          wallet: value,
          trust: 0.5,
          mint: "—",
          priceUsd: 0,
          ts: Date.now(),
        },
        ...(prev ?? []),
      ].slice(0, 60),
    );

    setWalletInput("");
    setInvalid(false);
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="dot-pulse text-foreground" aria-hidden />
          <CardTitle>SMART-WALLET FEED</CardTitle>
          <Badge variant="outline">HELIUS WEBHOOK</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="label-mono">{events.length} EVT</span>
        </div>
        <form
          onSubmit={onSubmit}
          className="mt-2 flex w-full items-center gap-2"
          aria-label="Track wallet"
        >
          <Input
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            placeholder="TRACK WALLET ADDRESS"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || undefined}
            className={cn(
              "flex-1",
              invalid && "border-[var(--loss)] focus-visible:border-[var(--loss)]",
            )}
          />
          <Button type="submit" variant="success" size="sm">
            + TRACK
          </Button>
        </form>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
        <ul role="list" className="font-mono">
          {events.map((e, i) => {
            const isEnter = e.kind === "entered";
            return (
              <li
                key={`${e.wallet}-${e.ts}-${i}`}
                className={cn(
                  "grid grid-cols-[56px_auto_1fr_auto] items-center gap-2 border-l-2 px-3 py-1.5 text-[11px]",
                  isEnter
                    ? "border-[var(--profit)]"
                    : "border-[var(--loss)]",
                )}
              >
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  {fmtTime(e.ts)}
                </span>
                <Badge
                  variant={isEnter ? "profit" : "loss"}
                  className="shrink-0"
                >
                  {isEnter ? "▲ IN" : "▼ OUT"}
                </Badge>
                <div className="flex items-center gap-2 truncate">
                  <span className="text-foreground tabular-nums">
                    W·<MintLink mint={e.wallet} kind="wallet" />
                  </span>
                  <span className="text-[var(--muted-foreground)]">→</span>
                  <span className="text-foreground tabular-nums">
                    <MintLink mint={e.mint} />
                  </span>
                  {isEnter ? (
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                      @ {fmtUsd(e.priceUsd)}
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                      {(e.fraction * 100).toFixed(0)}% OF POS
                    </span>
                  )}
                </div>
                {isEnter ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                      TRUST
                    </span>
                    <TrustBar trust={e.trust} />
                    <span className="text-[10px] tabular-nums">
                      {(e.trust * 100).toFixed(0)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--loss)] shrink-0">
                    EXIT
                  </span>
                )}
              </li>
            );
          })}
          {events.length === 0 && (
            <li className="px-3 py-6 text-center text-[var(--muted-foreground)] uppercase tracking-[0.16em] text-[10px]">
              NO WALLET ACTIVITY
            </li>
          )}
        </ul>
      </CardContent>
      <CardFooter>
        <span>TRACKED ON-CHAIN MIRRORS</span>
        <span>RING · 60</span>
      </CardFooter>
    </Card>
  );
}
