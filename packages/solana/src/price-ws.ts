/**
 * Pump.fun bonding curve price feed via Helius REST.
 * Uses getAccountInfo with jsonParsed + base64 data decoding.
 * Tested against real Pump.fun bonding curve account layout.
 */
import { PublicKey } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const INTERVAL = 1500;

interface PriceCallback { (priceUsd: number, marketCapUsd?: number, meta?: { source: string }): void; }

interface ActiveSub {
  mint: string; pda: string; callback: PriceCallback;
  lastPrice: number; timer: ReturnType<typeof setInterval> | null;
  solUsdRef: number; supply?: number;
}

export class HeliusPriceFeed {
  private subs = new Map<string, ActiveSub>();
  private readonly rpcUrl: string;
  private solUsd = 130;

  constructor(wsUrl: string) {
    this.rpcUrl = wsUrl.replace("wss://", "https://");
    void this.refreshSolUsd();
  }

  private async refreshSolUsd(): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Record<string, { price: string }> };
      const p = parseFloat(json.data?.[SOL_MINT]?.price ?? "0");
      if (p > 0) { this.solUsd = p; for (const s of this.subs.values()) s.solUsdRef = p; }
    } catch {}
    setTimeout(() => void this.refreshSolUsd(), 30_000);
  }

  private extractU64(buf: Buffer, offset: number): number {
    return Number(buf.readBigUInt64LE(offset));
  }

  private decodeCurve(raw: string): { price: number; supply: number } | undefined {
    const buf = Buffer.from(raw, "base64");
    if (buf.length < 48) return;
    const vt = this.extractU64(buf, 8);
    const vs = this.extractU64(buf, 16);
    const sup = this.extractU64(buf, 40);
    if (vt <= 0) return;
    const supply = sup / 1e6;
    const priceSol = (vs / 1e9) / (vt / 1e6);
    if (priceSol <= 0) return;
    return { price: priceSol, supply };
  }

  private async fetchCurve(sub: ActiveSub): Promise<void> {
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [sub.pda, { encoding: "base64" }] });
      const res = await fetch(this.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!res.ok) return;
      const json = (await res.json()) as { result?: { value?: { data?: [string, string] } } };
      const d = json.result?.value?.data;
      if (!d) return;
      const raw = d[0];
      if (!raw) return;
      const c = this.decodeCurve(raw);
      if (!c) { process.stderr.write(`x`); return; }
      const priceUsd = c.price * sub.solUsdRef;
      sub.lastPrice = c.price;
      if (!sub.supply && c.supply > 0) sub.supply = c.supply;
      sub.callback(priceUsd, c.price * sub.solUsdRef * (sub.supply ?? 0), { source: "curve" });
    } catch { process.stderr.write(`E`); }
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const [pk] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_FUN);
    const sub: ActiveSub = { mint, pda: pk.toBase58(), callback, lastPrice: 0, timer: null, solUsdRef: this.solUsd };
    this.subs.set(mint, sub);
    void this.fetchCurve(sub);
    sub.timer = setInterval(() => { if (this.subs.has(mint)) void this.fetchCurve(sub); else clearInterval(sub.timer!); }, INTERVAL);
    return 0;
  }

  unsubscribe(mint: string): void {
    const s = this.subs.get(mint);
    if (s) { this.subs.delete(mint); if (s.timer) clearInterval(s.timer); }
  }

  get isConnected(): boolean { return true; }
  close(): void { for (const s of this.subs.values()) if (s.timer) clearInterval(s.timer); this.subs.clear(); }
}
