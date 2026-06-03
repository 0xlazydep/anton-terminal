/**
 * Helius getAsset + Jupiter dual-source price feed.
 * No manual curve decoding. Helius DAS gives price_per_token directly.
 */
const INTERVAL = 1500;

interface PriceCallback { (priceUsd: number, marketCapUsd?: number, meta?: { source: string }): void; }

interface ActiveSub {
  mint: string; callback: PriceCallback; timer: ReturnType<typeof setInterval> | null;
}

export class HeliusPriceFeed {
  private subs = new Map<string, ActiveSub>();
  private readonly rpcUrl: string;

  constructor(wsUrl: string) {
    this.rpcUrl = wsUrl.replace("wss://", "https://");
  }

  private async fetchHelius(sub: ActiveSub): Promise<void> {
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: sub.mint } });
      const res = await fetch(this.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!res.ok) return;
      const json = (await res.json()) as {
        result?: { token_info?: { price_info?: { price_per_token?: number }, supply?: number } };
      };
      const ti = json.result?.token_info;
      const p = ti?.price_info?.price_per_token;
      if (!p || p <= 0) return;
      const mc = ti?.supply ? p * (ti.supply / 1e6) : undefined;
      sub.callback(p, mc, { source: "helius" });
    } catch {}
  }

  private async fetchJup(sub: ActiveSub): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${sub.mint}&showExtraInfo=true`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }> };
      const d = json.data?.[sub.mint];
      if (!d) return;
      const p = parseFloat(d.price) || 0;
      if (p <= 0) return;
      sub.callback(p, d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined, { source: "jupiter" });
    } catch {}
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const sub: ActiveSub = { mint, callback, timer: null };
    this.subs.set(mint, sub);
    void this.fetchHelius(sub);
    void this.fetchJup(sub);
    sub.timer = setInterval(() => {
      if (!this.subs.has(mint)) { clearInterval(sub.timer!); return; }
      void this.fetchHelius(sub);
    }, INTERVAL);
    return 0;
  }

  unsubscribe(mint: string): void {
    const s = this.subs.get(mint);
    if (s) { this.subs.delete(mint); if (s.timer) clearInterval(s.timer); }
  }

  get isConnected(): boolean { return true; }
  close(): void { for (const s of this.subs.values()) if (s.timer) clearInterval(s.timer); this.subs.clear(); }
}
