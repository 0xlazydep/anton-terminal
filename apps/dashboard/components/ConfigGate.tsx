"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

const CONFIG_PASSWORD = process.env.NEXT_PUBLIC_CONFIG_PASSWORD ?? "pr1nce-terminal";

export function ConfigGate({
  open,
  onUnlock,
  onClose,
}: {
  open: boolean;
  onUnlock: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (!open) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input === CONFIG_PASSWORD) {
      setError(false);
      setInput("");
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-[320px] border border-[var(--border)] bg-background p-6"
      >
        <h2 className="text-xs font-bold uppercase tracking-[0.24em] mb-1">
          CONFIG ACCESS
        </h2>
        <p className="text-[10px] text-[var(--muted-foreground)] mb-4 leading-relaxed">
          Enter authorization token to modify agent parameters.
        </p>

        <input
          type="password"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(false);
          }}
          placeholder="••••••••••••"
          autoFocus
          className="w-full h-9 border border-[var(--border)] bg-transparent px-3 text-xs font-mono text-foreground placeholder:text-[var(--muted-foreground)] outline-none focus:border-foreground mb-3"
        />

        {error && (
          <p className="text-[10px] text-[var(--loss)] mb-3">
            Invalid token. Access denied.
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </Button>
          <Button type="submit" variant="success" size="sm">
            UNLOCK
          </Button>
        </div>
      </form>
    </div>
  );
}
