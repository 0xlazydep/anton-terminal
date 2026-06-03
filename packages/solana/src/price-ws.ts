/**
 * Helius WebSocket + Jupiter dual price feed — zero-throttle, minimal latency.
 *
 * Helius `logsSubscribe` fires on every on-chain event mentioning the mint
 * (swap, transfer, create). On notification we immediately fetch from Jupiter
 * REST API. Jupiter polling (500ms) runs as keepalive for quiet markets.
 *
 * No throttle on WS-triggered fetches. Every swap = immediate price update.
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
          this.doLogsSubscribe(sub);
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
    }, 2000);
  }

  private handleMessage(data: Record<string, unknown>): void {
    if ((data as { id?: number }).id !== undefined) return;

    const params = data.params as Record<string, unknown> | undefined;
    if (!params) return;

    const subId = (params.subscription as number) ?? 0;
    const sub = this.subs.get(subId);
    if (!sub) return;

    this.fetchAndUpdate(sub);
  }

  private async fetchAndUpdate(sub: ActiveSub): Promise<void> {
    const { price, marketCap } = await this.fetchJupiterPrice(sub.mint);
    if (price <= 0) return;
    sub.lastPrice = price;
    sub.callback(price, marketCap);
  }

  private async fetchJupiterPrice(mint: string): Promise<{ price: number; marketCap?: number }> {
    try {
      const res = await fetch(
        `https://api.jup.ag/price/v2?ids=${mint}&showExtraInfo=true`,
      );
      if (!res.ok) return { price: 0 };
      const json = (await res.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const d = json.data?.[mint];
      if (!d) return { price: 0 };
      return {
        price: parseFloat(d.price) || 0,
        marketCap: d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined,
      };
    } catch {
      return { price: 0 };
    }
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
      params: [
        { mentions: [sub.mint] },
        { commitment: "processed" },
      ],
    });
  }

  async subscribe(mint: string, callback: PriceCallback, _poolPubkey?: string): Promise<number> {
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

    this.fetchAndUpdate(sub);

    if (this.connected) {
      this.doLogsSubscribe(sub);
    }

    sub.pollTimer = setInterval(() => {
      if (this.subs.has(subId)) {
        this.fetchAndUpdate(sub);
      } else {
        clearInterval(sub.pollTimer!);
      }
    }, 500);

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
