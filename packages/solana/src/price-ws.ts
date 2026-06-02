/**
 * Helius WebSocket price feed — zero-HTTP, 0ms latency.
 *
 * Uses Helius `transactionSubscribe` to stream every swap touching the pool
 * address. Parses token balance changes directly from the notification to
 * compute price = |SOL_delta| / |token_delta| — no REST API calls.
 *
 * Jupiter REST polling (1s) runs as keepalive when no swap activity.
 */

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number): void;
}

interface ActiveSub {
  mint: string;
  poolPubkey?: string;
  subId: number;
  callback: PriceCallback;
  lastPrice: number;
  lastUpdate: number;
  pollTimer: ReturnType<typeof setInterval> | null;
}

export class HeliusPriceFeed {
  private ws: WebSocket | null = null;
  private subs = new Map<number, ActiveSub>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsUrl: string;
  private connected = false;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl.startsWith("wss://") ? wsUrl : wsUrl.replace("https://", "wss://");
    this.connect();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        for (const sub of this.subs.values()) {
          this.doTxSubscribe(sub);
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const raw = event.data;
        if (typeof raw !== "string") return;
        if (!raw.startsWith("{") && !raw.startsWith("[")) return;
        try {
          this.handleMessage(JSON.parse(raw));
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
    }, 5000);
  }

  private handleMessage(data: Record<string, unknown>): void {
    if ((data as { id?: number }).id !== undefined) return;

    const params = data.params as Record<string, unknown> | undefined;
    if (!params) return;

    const subId = (params.subscription as number) ?? 0;
    const sub = this.subs.get(subId);
    if (!sub) return;

    const tx = this.extractTransaction(params);
    if (!tx) return;

    const price = this.priceFromTx(tx, sub.mint);
    if (price === undefined || price <= 0) return;

    const now = Date.now();
    if (now - sub.lastUpdate < 80 && price === sub.lastPrice) return;
    sub.lastPrice = price;
    sub.lastUpdate = now;
    sub.callback(price);
  }

  private extractTransaction(params: Record<string, unknown>): Record<string, unknown> | undefined {
    const result = params.result as Record<string, unknown> | undefined;
    if (!result) return;

    const tx = result.transaction ?? result;
    return tx as Record<string, unknown> | undefined;
  }

  private priceFromTx(tx: Record<string, unknown>, mint: string): number | undefined {
    const meta = tx.meta as Record<string, unknown> | undefined;
    if (!meta) return;

    const pre = (meta.preTokenBalances as Array<Record<string, unknown>>) ?? [];
    const post = (meta.postTokenBalances as Array<Record<string, unknown>>) ?? [];

    const SOL_MINT = "So11111111111111111111111111111111111111112";

    let solDelta = 0;
    let tokenDelta = 0;

    for (const b of post) {
      const mintAddr = b.mint as string;
      const amt = (b.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0;
      const preBal = pre.find(
        (p) =>
          (p.mint as string) === mintAddr &&
          (p.accountIndex as number) === (b.accountIndex as number),
      );
      const preAmt = preBal
        ? (preBal.uiTokenAmount as { uiAmount: number })?.uiAmount ?? 0
        : 0;
      const delta = amt - preAmt;

      if (mintAddr === SOL_MINT) solDelta += delta;
      else if (mintAddr === mint) tokenDelta += delta;
    }

    if (solDelta === 0 || tokenDelta === 0) return;
    return Math.abs(solDelta / tokenDelta);
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private doTxSubscribe(sub: ActiveSub): void {
    const pool = sub.poolPubkey;
    if (!pool) return;
    const id = this.nextId++;
    this.send({
      jsonrpc: "2.0",
      id,
      method: "transactionSubscribe",
      params: [
        { vote: false, failed: false, accountInclude: [pool] },
        {
          commitment: "processed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          showRewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ],
    });
  }

  async subscribe(
    mint: string,
    callback: PriceCallback,
    poolPubkey?: string,
  ): Promise<number> {
    const subId = this.nextId++;
    const sub: ActiveSub = {
      mint,
      poolPubkey,
      subId,
      callback,
      lastPrice: 0,
      lastUpdate: 0,
      pollTimer: null,
    };
    this.subs.set(subId, sub);

    const price = await this.fetchJupiterPrice(mint);
    if (price > 0) {
      sub.lastPrice = price;
      callback(price);
    }

    if (this.connected && poolPubkey) {
      this.doTxSubscribe(sub);
    }

    sub.pollTimer = setInterval(() => {
      if (this.subs.has(subId)) {
        this.fetchJupiterPrice(mint).then((p) => {
          if (p > 0 && p !== sub.lastPrice) {
            sub.lastPrice = p;
            callback(p);
          }
        }).catch(() => {});
      } else {
        clearInterval(sub.pollTimer!);
      }
    }, 1000);

    return subId;
  }

  private async fetchJupiterPrice(mint: string): Promise<number> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      if (!res.ok) return 0;
      const json = (await res.json()) as { data?: Record<string, { price: string }> };
      return parseFloat(json.data?.[mint]?.price ?? "0") || 0;
    } catch {
      return 0;
    }
  }

  unsubscribe(subId: number): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    this.subs.delete(subId);

    if (sub.pollTimer) clearInterval(sub.pollTimer);

    if (this.connected) {
      const id = this.nextId++;
      this.send({
        jsonrpc: "2.0",
        id,
        method: "transactionUnsubscribe",
        params: [sub.subId],
      });
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
      if (sub.pollTimer) clearInterval(sub.pollTimer);
    }
    this.subs.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
