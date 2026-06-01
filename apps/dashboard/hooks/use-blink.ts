"use client";

import { useEffect, useRef, useState } from "react";

export function useBlink(value: number | undefined): "up" | "down" | null {
  const prev = useRef<number | undefined>(value);
  const [blink, setBlink] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (value === undefined || prev.current === undefined || value === prev.current) {
      prev.current = value;
      return;
    }
    const direction = value > prev.current ? "up" : "down";
    prev.current = value;
    setBlink(direction);
    const t = setTimeout(() => setBlink(null), 600);
    return () => clearTimeout(t);
  }, [value]);

  return blink;
}
