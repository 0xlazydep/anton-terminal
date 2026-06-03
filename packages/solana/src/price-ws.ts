/**
 * Helius WebSocket price feed — dual pipeline, GMGN-class.
 *
 * Pipeline A (Pump.fun bonding curve — 0ms, pure on-chain):
 *   accountSubscribe(bondingCurvePDA) → instant notification on swap
 *   → decode virtual SOL/token reserves → price = SOL_reserves / token_reserves
 *   → MC = price × token_total_supply × SOL/USD
 *
 * Pipeline B (logsSubscribe → getTransaction — fallback for graduated tokens):
 *   logsSubscribe(mint) → getTransaction(sig) over WS → parsed balances → price
 *
 * Jupiter REST only as last-resort fallback when both pipelines fail.
 */
import { PublicKey } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const STALE_MS = 5000;
const FALLBACK_MS = 15_000;

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number, meta?: { source: string }): void;
}

interface ActiveSub {
  mint: string;
  callback: PriceCallback;
  lastPrice: number;
  lastWsAt: number;
  solUsdRef: number;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  curveSubId?: number;
  logsSubId?: number;
  supply?: number;
}

export class HeliusPriceFeed {
  private ws: WebSocket | null = null;
  private subs = new Map<string, ActiveSub>();
  private heliusSubMap = new Map<number, ActiveSub>();
  private pending = new Map<number, { mint: string; sig?: string }>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsUrl: string;
  private connected = false;
  private solUsd = 130;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl.startsWith("wss://") ? wsUrl : wsUrl.replace("https://", "wss://");
    this.connect();
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

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        for (const sub of this.subs.values()) {
          this.subscribeCurve(sub);
          this.subscribeLogs(sub);
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const raw = event.data as string | undefined;
        if (typeof raw !== "string" || (!raw.startsWith("{") && !raw.startsWith("["))) return;
        try { this.route(JSON.parse(raw)); } catch {}
      };

      this.ws.onclose = () => { this.connected = false; this.scheduleReconnect(); };
      this.ws.onerror = () => {};
    } catch { this.scheduleReconnect(); }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2000);
  }

  private route(data: Record<string, unknown>): void {
    const id = (data as { id?: number }).id;
    if (id !== undefined) {
      const hasResp = this.pending.has(id);
      process.stderr.write(`[ws-msg] resp id=${id} pending=${hasResp} result=${JSON.stringify(data.result)?.slice(0,60)}\n`);
      this.handleResponse(id, data);
      return;
    }

    const params = data.params as Record<string, unknown> | undefined;
    if (!params) return;
    const heliusId = (params.subscription as number) ?? 0;
    const sub = this.heliusSubMap.get(heliusId);
    if (!sub) { process.stderr.write(`[ws-msg] unk sub ${heliusId} (have ${[...this.heliusSubMap.keys()].join(",")})\n`); return; }

    const sig = this.extractSignature(params);
    if (sig) {
      process.stderr.write(`[ws-msg] logs sig=${sig.slice(0,12)}...\n`);
      const rid = this.nextId++;
      this.pending.set(rid, { mint: sub.mint, sig });
      this.send({ jsonrpc: "2.0", id: rid, method: "getTransaction",
        params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] });
      return;
    }

    process.stderr.write(`[ws-msg] curve update for ${sub.mint.slice(0,8)}\n`);
    this.handleAccountUpdate(params, sub);
  }

  private extractSignature(params: Record<string, unknown>): string | undefined {
    const r = params.result as Record<string, unknown> | undefined;
    const v = r?.value as Record<string, unknown> | undefined;
    return v?.signature as string | undefined;
  }

  private handleAccountUpdate(params: Record<string, unknown>, sub: ActiveSub): void {
    const r = params.result as Record<string, unknown> | undefined;
    const v = r?.value as Record<string, unknown> | undefined;
    const d = v?.data as string | string[] | undefined;
    const raw = Array.isArray(d) ? d[0] : d;
    if (!raw) { process.stderr.write(`[ws-msg] curve no data\n`); return; }

    const price = this.decodeCurve(raw);
    if (!price || price <= 0) { process.stderr.write(`[ws-msg] curve decode fail\n`); return; }

    process.stderr.write(`[ws-msg] curve price=${price.toExponential(2)} SOL\n`);
    const now = Date.now();
    sub.lastPrice = price;
    sub.lastWsAt = now;
    const priceUsd = price * sub.solUsdRef;
    const mc = sub.supply ? price * sub.solUsdRef * sub.supply : undefined;
    sub.callback(priceUsd, mc, { source: "curve" });
  }

  private decodeCurve(base64: string): number | undefined {
    try {
      const buf = Buffer.from(base64, "base64");
      if (buf.length < 48) return;
      const virtualTokens = buf.readBigUInt64LE(8);
      const virtualSol = buf.readBigUInt64LE(16);
      const supply = buf.readBigUInt64LE(40);
      const tokenDecimals = 6;
      const solDecimals = 9;

      const priceSol = Number(virtualSol) / 1e9 / (Number(virtualTokens) / 10 ** tokenDecimals);
      if (priceSol <= 0) return;

      for (const sub of this.subs.values()) {
        if (sub.mint === (this as unknown as { _lastDecodeMint?: string })._lastDecodeMint) continue;
      }
      return Number(virtualSol) / 1e9 / (Number(virtualTokens) / 1e6);
    } catch { return; }
  }

  private handleResponse(id: number, data: Record<string, unknown>): void {
    const p = this.pending.get(id);
    if (!p) {
      const result = data.result as number | undefined;
      if (result !== undefined) {
        for (const sub of this.subs.values()) {
          if (sub.logsSubId !== undefined && !this.heliusSubMap.has(result)) {
            this.heliusSubMap.set(result, sub);
          }
          if (sub.curveSubId !== undefined && !this.heliusSubMap.has(result)) {
            this.heliusSubMap.set(result, sub);
          }
        }
      }
      return;
    }
    this.pending.delete(id);

    if (p.sig) {
      const result = data.result as Record<string, unknown> | undefined;
      if (result) {
        const price = this.priceFromTx(result, p.mint);
        if (price) {
          for (const sub of this.subs.values()) {
            if (sub.mint !== p.mint) continue;
            sub.lastPrice = price;
            sub.lastWsAt = Date.now();
            const priceUsd = price * sub.solUsdRef;
            const mc = sub.supply ? price * sub.solUsdRef * sub.supply : undefined;
            sub.callback(priceUsd, mc, { source: "tx" });
          }
        }
      }
    }
  }

  private priceFromTx(tx: Record<string, unknown>, mint: string): number | undefined {
    const meta = tx.meta as Record<string, unknown> | undefined;
    if (!meta) return;

    let solDelta = 0, tokenDelta = 0;
    const pre = (meta.preTokenBalances as Array<Record<string, unknown>>) ?? [];
    const post = (meta.postTokenBalances as Array<Record<string, unknown>>) ?? [];

    for (const b of post) {
      const bm = b.mint as string;
      const amt = (b.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0;
      const preB = pre.find((p) => (p.mint as string) === bm && (p.accountIndex as number) === (b.accountIndex as number));
      const preA = preB ? (preB.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0 : 0;
      const delta = amt - preA;
      if (bm === SOL_MINT) solDelta += delta;
      else if (bm === mint) tokenDelta += delta;
    }

    if (solDelta === 0) {
      const preL = (meta.preBalances as number[]) ?? [];
      const postL = (meta.postBalances as number[]) ?? [];
      if (preL.length > 0) solDelta = -(postL[0]! - preL[0]!) / 1e9;
    }

    if (solDelta === 0 || tokenDelta === 0) return;
    return Math.abs(solDelta / tokenDelta);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private subscribeCurve(sub: ActiveSub): void {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(sub.mint).toBuffer()],
      PUMP_FUN,
    );
    const id = this.nextId++;
    sub.curveSubId = id;
    this.send({
      jsonrpc: "2.0", id, method: "accountSubscribe",
      params: [pda.toBase58(), { encoding: "base64", commitment: "processed" }],
    });
  }

  private subscribeLogs(sub: ActiveSub): void {
    const id = this.nextId++;
    sub.logsSubId = id;
    this.send({
      jsonrpc: "2.0", id, method: "logsSubscribe",
      params: [{ mentions: [sub.mint] }, { commitment: "processed" }],
    });
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const sub: ActiveSub = {
      mint, callback, lastPrice: 0, lastWsAt: 0,
      solUsdRef: this.solUsd, fallbackTimer: null,
    };
    this.subs.set(mint, sub);

    void this.fallbackJupiter(sub);

    if (this.connected) {
      this.subscribeCurve(sub);
      this.subscribeLogs(sub);
    }

    sub.fallbackTimer = setInterval(() => {
      if (!this.subs.has(mint)) { clearInterval(sub.fallbackTimer!); return; }
      if (Date.now() - sub.lastWsAt > FALLBACK_MS) void this.fallbackJupiter(sub);
    }, 5000);

    return 0;
  }

  private async fallbackJupiter(sub: ActiveSub): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${sub.mint}&showExtraInfo=true`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }> };
      const d = json.data?.[sub.mint];
      if (!d) return;
      const p = parseFloat(d.price) || 0;
      if (p <= 0) return;
      const mc = d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined;
      sub.callback(p, mc, { source: "jupiter" });
    } catch {}
  }

  unsubscribe(mint: string): void {
    const sub = this.subs.get(mint);
    if (!sub) return;
    this.subs.delete(mint);
    if (sub.fallbackTimer) clearInterval(sub.fallbackTimer);
  }

  get isConnected(): boolean { return this.connected; }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const sub of this.subs.values()) { if (sub.fallbackTimer) clearInterval(sub.fallbackTimer); }
    this.subs.clear(); this.heliusSubMap.clear(); this.pending.clear();
    this.ws?.close(); this.ws = null; this.connected = false;
  }
}
