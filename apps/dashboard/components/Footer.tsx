"use client";

import { useEffect, useState } from "react";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CrownIcon } from "@/components/ui/crown-icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getSocket } from "@/lib/socket";

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PingDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-2 w-2",
          connected ? "bg-[var(--profit)] animate-ping-pulse" : "bg-[var(--loss)]",
        )}
        aria-hidden
      />
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        {connected ? "LIVE" : "DOWN"}
      </span>
    </span>
  );
}

export function Footer({ onConfigToggle }: { onConfigToggle: () => void }) {
  const { uptimeSec } = useUI();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    const check = () => setConnected(socket.connected);
    check();
    socket.on("connect", check);
    socket.on("disconnect", () => setConnected(false));
    const id = setInterval(check, 5000);
    return () => {
      clearInterval(id);
      socket.off("connect", check);
      socket.off("disconnect");
    };
  }, []);

  return (
    <footer className="sticky bottom-0 z-30 flex h-9 w-full items-center gap-3 border-t border-[var(--border)] bg-background/95 px-4 backdrop-blur-sm">
      <CrownIcon className="h-4 w-4 shrink-0 hidden sm:block" />
      <span className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted-foreground)] truncate">PR1NCE EXPERIMENTAL // ANTON-TERMINAL</span>

      <div className="flex-1" />

      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)] tabular-nums">
        UP {fmtUptime(uptimeSec)}
      </span>

      <PingDot connected={connected} />

      <ThemeToggle />

      <Button
        variant="ghost"
        size="sm"
        onClick={onConfigToggle}
        className="h-6 px-2 text-[9px] uppercase tracking-[0.14em] text-[var(--muted-foreground)] hover:text-foreground"
      >
        <span className="hidden sm:inline">⚙ CONFIG</span>
        <span className="sm:hidden">⚙</span>
      </Button>
    </footer>
  );
}
