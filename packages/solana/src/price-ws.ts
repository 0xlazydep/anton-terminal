/**
 * Helius REST-based price feed. Reliable, no WebSocket reconnect issues.
 *
 * Pipeline A (Pump.fun bonding curve): Helius REST getAccountInfo every 1.5s
 * → decode virtual SOL/token reserves from on-chain bonding curve PDA
 * → price = SOL_reserves / token_reserves, MC = price × supply
 *
 * Pipeline B (Jupiter): REST fallback for graduated/non-Pump tokens every 1s.
 *
 * DexScreener: backup only (3s poll from agent).
 */
import { PublicKey } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const CURVE_INTERVAL = 1500;
const JUP_INTERVAL = 3000;

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number, meta?: { source: string }): void;
}

interface ActiveSub {
  mint: string;
  pda: string;
  callback: PriceCallback;
  lastPrice: number;
  curveTimer: ReturnType<typeof setInterval> | null;
  jupTimer: ReturnType<typeof setInterval> | null;
  solUsdRef: number;
  supply?: number;
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
      if (p > 0) { this.solUsd = p; for (const sub of this.subs.values()) sub.solUsdRef = p; }
    } catch {}
    setTimeout(() => void this.refreshSolUsd(), 30_000);
  }

  private decodeCurve(base64: string): { price: number; supply: number } | undefined {
    try {
      const buf = Buffer.from(base64, "base64");
      process.stderr.write(`[curve-debug] len=${buf.length} bytes\n`);
      if (buf.length < 40) { process.stderr.write(`[curve-debug] too short\n`); return; }
      const vTokRaw = buf.readBigUInt64LE(8);
      const vSolRaw = buf.readBigUInt64LE(16);
      const supplyRaw = buf.readBigUInt64LE(40);
      process.stderr.write(`[curve-debug] vt=${vTokRaw} vs=${vSolRaw} sup=${supplyRaw}\n`);
      const virtualTokens = Number(vTokRaw) / 1e6;
      const virtualSol = Number(vSolRaw) / 1e9;
      const supply = Number(supplyRaw) / 1e6;
      process.stderr.write(`[curve-debug] vtF=${virtualTokens} vsF=${virtualSol}\n`);
      if (virtualTokens <= 0) { process.stderr.write(`[curve-debug] vt<=0\n`); return; }
      return { price: virtualSol / virtualTokens, supply };
    } catch(err) {
      process.stderr.write(`[curve-debug] exception: ${String(err)}\n`);
      return;
    }
  }

  private async fetchCurve(sub: ActiveSub): Promise<void> {
    try {
      const body = JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getAccountInfo",
        params: [sub.pda, { encoding: "base64" }],
      });
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) { process.stderr.write(`[curve] ${sub.mint.slice(0,8)} HTTP ${res.status}\n`); return; }
      const json = (await res.json()) as {
        result?: { value?: { data?: [string, string] } };
      };
      const data = json.result?.value?.data;
      if (!data) { process.stderr.write(`[curve] ${sub.mint.slice(0,8)} no account data (PDA=${sub.pda.slice(0,12)}...)\n`); return; }
      const raw = Array.isArray(data) ? data[0] : data;
      if (!raw) return;

      const curve = this.decodeCurve(raw);
      if (!curve || curve.price <= 0) { process.stderr.write(`[curve] ${sub.mint.slice(0,8)} decode fail len=${raw.length}\n`); return; }

      const priceUsd = curve.price * sub.solUsdRef;
      sub.lastPrice = curve.price;
      if (curve.supply > 0 && !sub.supply) sub.supply = curve.supply;
      const mc = sub.supply ? curve.price * sub.solUsdRef * sub.supply : undefined;
      process.stderr.write(`[curve] ${sub.mint.slice(0,8)} $${priceUsd?.toExponential(3)} mc=${mc ? (mc/1000).toFixed(1)+"K" : "?"}\n`);
      sub.callback(priceUsd, mc, { source: "curve" });
    } catch(err) { process.stderr.write(`[curve] ${sub.mint.slice(0,8)} error ${String(err).slice(0,60)}\n`); }
  }

  private async fetchJup(sub: ActiveSub): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${sub.mint}&showExtraInfo=true`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const d = json.data?.[sub.mint];
      if (!d) return;
      const p = parseFloat(d.price) || 0;
      if (p <= 0) return;
      const mc = d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined;
      sub.callback(p, mc, { source: "jupiter" });
    } catch {}
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    let pda = "";
    try {
      const [pk] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
        PUMP_FUN,
      );
      pda = pk.toBase58();
    } catch(err) {
      process.stderr.write(`[curve] PDA fail for ${mint.slice(0,8)}: ${String(err).slice(0,40)}\n`);
      return 0;
    }
    const sub: ActiveSub = {
      mint, pda, callback, lastPrice: 0,
      curveTimer: null, jupTimer: null, solUsdRef: this.solUsd,
    };
    this.subs.set(mint, sub);

    process.stderr.write(`[curve] sub ${mint.slice(0,8)} pda=${pda.slice(0,16)}... rpc=${this.rpcUrl.slice(0,40)}...\n`);
    void this.fetchCurve(sub);
    void this.fetchJup(sub);

    sub.curveTimer = setInterval(() => {
      if (!this.subs.has(mint)) { clearInterval(sub.curveTimer!); return; }
      void this.fetchCurve(sub);
    }, CURVE_INTERVAL);

    sub.jupTimer = setInterval(() => {
      if (!this.subs.has(mint)) { clearInterval(sub.jupTimer!); return; }
      void this.fetchJup(sub);
    }, JUP_INTERVAL);

    return 0;
  }

  unsubscribe(mint: string): void {
    const sub = this.subs.get(mint);
    if (!sub) return;
    this.subs.delete(mint);
    if (sub.curveTimer) clearInterval(sub.curveTimer);
    if (sub.jupTimer) clearInterval(sub.jupTimer);
  }

  get isConnected(): boolean { return true; }

  close(): void {
    for (const sub of this.subs.values()) {
      if (sub.curveTimer) clearInterval(sub.curveTimer);
      if (sub.jupTimer) clearInterval(sub.jupTimer);
    }
    this.subs.clear();
  }
}
