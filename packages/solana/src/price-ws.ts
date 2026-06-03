/**
 * Helius WebSocket price feed — pure on-chain, GMGN-class latency.
 *
 * Pipeline (all over ONE WebSocket, zero REST in hot path):
 *   1. logsSubscribe(mint)            → fires on every swap (~processed commitment)
 *   2. getTransaction(sig) over WS    → parsed pre/post balances (~50-100ms)
 *   3. price = |SOL_delta| / |token_delta|   (real-time, from the actual swap)
 *   4. MC    = price × cached_supply         (supply fetched once via getTokenSupply)
 *
 * Latency is measured from on-chain blockTime → local receive time. Updates
 * older than STALE_MS are flagged. Jupiter REST is a FALLBACK only, used when
 * the WS produces no swap for FALLBACK_MS (quiet market / cold token).
 */

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STALE_MS = 2000;
const FALLBACK_MS = 10_000;

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  /** ms from on-chain event to local receipt. undefined for fallback path. */
  latencyMs?: number;
  source: "ws" | "jupiter";
}

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number, meta?: PriceUpdate): void;
}

interface ActiveSub {
  mint: string;
  subId: number;
  callback: PriceCallback;
  lastPrice: number;
  lastWsAt: number;
  supply?: number;
  solUsdRef: number;
  fallbackTimer: ReturnType<typeof setInterval> | null;
}

export class HeliusPriceFeed {
  private ws: WebSocket | null = null;
  private subs = new Map<number, ActiveSub>();
  private pendingTx = new Map<number, string>();
  private pendingSupply = new Map<number, string>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsUrl: string;
  private connected = false;
  private solUsd = 0;
  private lastLatencyWarn = 0;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl.startsWith("wss://") ? wsUrl : wsUrl.replace("https://", "wss://");
    this.connect();
    void this.refreshSolUsd();
    setInterval(() => void this.refreshSolUsd(), 30_000);
  }

  private async refreshSolUsd(): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Record<string, { price: string }> };
      const p = parseFloat(json.data?.[SOL_MINT]?.price ?? "0");
      if (p > 0) {
        this.solUsd = p;
        for (const sub of this.subs.values()) sub.solUsdRef = p;
      }
    } catch {}
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        for (const sub of this.subs.values()) {
          this.doLogsSubscribe(sub);
          this.requestSupply(sub.mint);
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const raw = event.data;
        if (typeof raw !== "string") return;
        if (!raw.startsWith("{") && !raw.startsWith("[")) return;
        try {
          this.route(JSON.parse(raw));
        } catch {}
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {};
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private route(data: Record<string, unknown>): void {
    const id = (data as { id?: number }).id;
    if (id !== undefined) {
      if (this.pendingTx.has(id)) this.handleTxResponse(id, data);
      else if (this.pendingSupply.has(id)) this.handleSupplyResponse(id, data);
      return;
    }

    const params = data.params as Record<string, unknown> | undefined;
    if (!params) return;
    const subId = (params.subscription as number) ?? 0;
    const sub = this.subs.get(subId);
    if (!sub) return;

    const sig = this.extractSignature(params);
    if (!sig) return;

    const rid = this.nextId++;
    this.pendingTx.set(rid, sub.mint);
    this.send({
      jsonrpc: "2.0",
      id: rid,
      method: "getTransaction",
      params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    });
  }

  private extractSignature(params: Record<string, unknown>): string | undefined {
    const result = params.result as Record<string, unknown> | undefined;
    const value = result?.value as Record<string, unknown> | undefined;
    return value?.signature as string | undefined;
  }

  private requestSupply(mint: string): void {
    const rid = this.nextId++;
    this.pendingSupply.set(rid, mint);
    this.send({
      jsonrpc: "2.0",
      id: rid,
      method: "getTokenSupply",
      params: [mint],
    });
  }

  private handleSupplyResponse(id: number, data: Record<string, unknown>): void {
    const mint = this.pendingSupply.get(id);
    if (!mint) return;
    this.pendingSupply.delete(id);

    const result = data.result as Record<string, unknown> | undefined;
    const value = result?.value as { uiAmount?: number } | undefined;
    const supply = value?.uiAmount;
    if (!supply || supply <= 0) return;

    for (const sub of this.subs.values()) {
      if (sub.mint === mint) sub.supply = supply;
    }
  }

  private handleTxResponse(id: number, data: Record<string, unknown>): void {
    const mint = this.pendingTx.get(id);
    if (!mint) return;
    this.pendingTx.delete(id);

    const result = data.result as Record<string, unknown> | undefined;
    if (!result) return;

    const blockTime = result.blockTime as number | undefined;
    const price = this.priceFromParsedTx(result, mint);
    if (price === undefined || price <= 0) return;

    const now = Date.now();
    const latencyMs = blockTime ? now - blockTime * 1000 : undefined;
    if (latencyMs !== undefined && latencyMs > STALE_MS && now - this.lastLatencyWarn > 10_000) {
      this.lastLatencyWarn = now;
      process.stderr.write(`[price-ws] feed latency ${(latencyMs / 1000).toFixed(1)}s for ${mint.slice(0, 8)}\n`);
    }

    for (const sub of this.subs.values()) {
      if (sub.mint !== mint) continue;
      sub.lastPrice = price;
      sub.lastWsAt = now;
      const mc = sub.supply ? price * sub.solUsdRef * sub.supply : undefined;
      const priceUsd = price * sub.solUsdRef;
      sub.callback(priceUsd, mc, { priceUsd, marketCapUsd: mc, latencyMs, source: "ws" });
    }
  }

  private priceFromParsedTx(tx: Record<string, unknown>, mint: string): number | undefined {
    const meta = tx.meta as Record<string, unknown> | undefined;
    if (!meta) return;

    let solDelta = 0;
    let tokenDelta = 0;

    const preTokens = (meta.preTokenBalances as Array<Record<string, unknown>>) ?? [];
    const postTokens = (meta.postTokenBalances as Array<Record<string, unknown>>) ?? [];

    for (const b of postTokens) {
      const bMint = b.mint as string;
      const amt = (b.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0;
      const preT = preTokens.find(
        (p) =>
          (p.mint as string) === bMint &&
          (p.accountIndex as number) === (b.accountIndex as number),
      );
      const preAmt = preT ? (preT.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0 : 0;
      const delta = amt - preAmt;
      if (bMint === SOL_MINT) solDelta += delta;
      else if (bMint === mint) tokenDelta += delta;
    }

    const preLamports = (meta.preBalances as number[]) ?? [];
    const postLamports = (meta.postBalances as number[]) ?? [];
    if (preLamports.length > 0 && postLamports.length > 0 && solDelta === 0) {
      const feePayerDelta = (postLamports[0] ?? 0) - (preLamports[0] ?? 0);
      solDelta = -feePayerDelta / 1e9;
    }

    if (solDelta === 0 || tokenDelta === 0) return;
    return Math.abs(solDelta / tokenDelta);
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private doLogsSubscribe(sub: ActiveSub): void {
    const id = this.nextId++;
    this.send({
      jsonrpc: "2.0",
      id,
      method: "logsSubscribe",
      params: [{ mentions: [sub.mint] }, { commitment: "processed" }],
    });
  }

  async subscribe(mint: string, callback: PriceCallback, _poolPubkey?: string): Promise<number> {
    const subId = this.nextId++;
    const sub: ActiveSub = {
      mint,
      subId,
      callback,
      lastPrice: 0,
      lastWsAt: 0,
      solUsdRef: this.solUsd,
      fallbackTimer: null,
    };
    this.subs.set(subId, sub);

    void this.fallbackJupiter(sub);

    if (this.connected) {
      this.doLogsSubscribe(sub);
      this.requestSupply(mint);
    }

    sub.fallbackTimer = setInterval(() => {
      if (!this.subs.has(subId)) {
        clearInterval(sub.fallbackTimer!);
        return;
      }
      if (Date.now() - sub.lastWsAt > FALLBACK_MS) {
        void this.fallbackJupiter(sub);
      }
    }, 3000);

    return subId;
  }

  private async fallbackJupiter(sub: ActiveSub): Promise<void> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${sub.mint}&showExtraInfo=true`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const d = json.data?.[sub.mint];
      if (!d) return;
      const priceUsd = parseFloat(d.price) || 0;
      if (priceUsd <= 0) return;
      const mc = d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined;
      sub.callback(priceUsd, mc, { priceUsd, marketCapUsd: mc, source: "jupiter" });
    } catch (err: unknown) {
      if (String(err).includes("429")) {
        process.stderr.write(`[price-ws] Jupiter 429 for ${sub.mint.slice(0, 8)}\n`);
      }
    }
  }

  unsubscribe(subId: number): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    this.subs.delete(subId);
    if (sub.fallbackTimer) clearInterval(sub.fallbackTimer);

    if (this.connected) {
      const id = this.nextId++;
      this.send({ jsonrpc: "2.0", id, method: "logsUnsubscribe", params: [sub.subId] });
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const sub of this.subs.values()) {
      if (sub.fallbackTimer) clearInterval(sub.fallbackTimer);
    }
    this.subs.clear();
    this.pendingTx.clear();
    this.pendingSupply.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
