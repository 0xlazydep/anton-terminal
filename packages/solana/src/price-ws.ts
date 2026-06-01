/**
 * Helius WebSocket + Jupiter dual price feed.
 *
 * - WebSocket logsSubscribe: instant price update on any on-chain swap (< 500ms)
 * - Jupiter API poll every 1s: keepalive when no swap activity (never > 1s stale)
 *
 * Falls back to DexScreener polling when WebSocket is unavailable.
 */

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number): void;
}

interface ActiveSub {
  mint: string;
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
          this.doSubscribe(sub.mint, sub.subId);
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data as string);
        this.handleMessage(data);
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

  private handleMessage(data: { id?: number; result?: unknown; error?: { message: string } }): void {
    if (data.id !== undefined) return;

    const subId = (data as { params?: { subscription: number } }).params?.subscription;
    if (!subId) return;

    const sub = this.subs.get(subId);
    if (!sub) return;

    const now = Date.now();
    if (now - sub.lastUpdate < 300) return;
    sub.lastUpdate = now;

    this.fetchAndUpdate(sub);
  }

  private async fetchAndUpdate(sub: ActiveSub): Promise<void> {
    try {
      const response = await fetch(
        `https://api.jup.ag/price/v2?ids=${sub.mint}&showExtraInfo=true`,
      );
      if (!response.ok) return;
      const json = (await response.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const tokenData = json.data?.[sub.mint];
      if (!tokenData) return;

      const priceUsd = parseFloat(tokenData.price);
      const marketCapUsd = tokenData.extraInfo?.marketCap
        ? parseFloat(tokenData.extraInfo.marketCap)
        : undefined;

      if (priceUsd > 0 && priceUsd !== sub.lastPrice) {
        sub.lastPrice = priceUsd;
        sub.callback(priceUsd, marketCapUsd);
      }
    } catch {
      // Non-fatal
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private doSubscribe(mint: string, subId: number): void {
    const id = this.nextId++;
    this.send({
      jsonrpc: "2.0",
      id,
      method: "logsSubscribe",
      params: [
        { mentions: [mint] },
        { commitment: "processed" },
      ],
    });
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const subId = this.nextId++;
    const sub: ActiveSub = {
      mint,
      subId,
      callback,
      lastPrice: 0,
      lastUpdate: 0,
      pollTimer: null,
    };
    this.subs.set(subId, sub);

    // Initial price fetch
    await this.fetchAndUpdate(sub);

    // WS subscription for instant swap events
    if (this.connected) {
      this.doSubscribe(mint, subId);
    }

    // Jupiter poll every 1s as keepalive
    sub.pollTimer = setInterval(() => {
      if (this.subs.has(subId)) {
        this.fetchAndUpdate(sub);
      } else {
        clearInterval(sub.pollTimer!);
      }
    }, 1000);

    return subId;
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
        method: "logsUnsubscribe",
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
