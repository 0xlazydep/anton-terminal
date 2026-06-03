/**
 * Jupiter price feed — simple, reliable REST polling every 1.5s.
 * Provides price + marketCap. No WebSocket, no curve decoding.
 */
const INTERVAL = 1500;

interface PriceCallback { (priceUsd: number, marketCapUsd?: number, meta?: { source: string }): void; }

export class HeliusPriceFeed {
  private subs = new Map<string, { mint: string; cb: PriceCallback; t: ReturnType<typeof setInterval> | null }>();

  private async fetch(mint: string, cb: PriceCallback): Promise<void> {
    try {
      const r = await fetch(`https://api.jup.ag/price/v2?ids=${mint}&showExtraInfo=true`);
      if (!r.ok) return;
      const j = (await r.json()) as { data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }> };
      const d = j.data?.[mint];
      if (!d) return;
      const p = parseFloat(d.price) || 0;
      if (p <= 0) return;
      cb(p, d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined, { source: "jupiter" });
    } catch {}
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    this.subs.set(mint, { mint, cb: callback, t: null });
    void this.fetch(mint, callback);
    const s = this.subs.get(mint)!;
    s.t = setInterval(() => { if (this.subs.has(mint)) void this.fetch(mint, callback); else clearInterval(s.t!); }, INTERVAL);
    return 0;
  }

  unsubscribe(mint: string): void {
    const s = this.subs.get(mint);
    if (s) { this.subs.delete(mint); if (s.t) clearInterval(s.t); }
  }

  get isConnected(): boolean { return true; }
  close(): void { for (const s of this.subs.values()) if (s.t) clearInterval(s.t); this.subs.clear(); }
}
