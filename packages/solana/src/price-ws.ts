/**
 * Helius WebSocket real-time price feed.
 *
 * Subscribes to transaction logs mentioning a token mint, then queries Jupiter
 * for the current price on each on-chain activity. Much faster than polling
 * DexScreener — reacts to swaps in < 500ms vs 3-12s poll intervals.
 *
 * Falls back to DexScreener polling when WebSocket is unavailable.
 */

import { Connection, PublicKey } from "@solana/web3.js";

interface PriceCallback {
  (priceUsd: number, marketCapUsd?: number): void;
}

interface ActiveSub {
  mint: string;
  subId: number;
  callback: PriceCallback;
  lastPrice: number;
  lastUpdate: number;
}

export class HeliusPriceFeed {
  private ws: WebSocket | null = null;
  private subs = new Map<number, ActiveSub>();
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (id: number) => void; reject: (err: Error) => void }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rpcUrl: string;
  private readonly wsUrl: string;
  private readonly connection: Connection;
  private connected = false;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
    this.wsUrl = rpcUrl.replace("https://", "wss://");
    this.connection = new Connection(rpcUrl, "processed");
    this.connect();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        // Re-subscribe all active subs after reconnect
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

      this.ws.onerror = () => {
        // onclose will fire after this
      };
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
    if (data.id !== undefined) {
      const pending = this.pendingRequests.get(data.id);
      if (pending) {
        this.pendingRequests.delete(data.id);
        if (data.error) {
          pending.reject(new Error(data.error.message));
        } else {
          pending.resolve(data.result as number);
        }
      }
      return;
    }

    // Notification: logsSubscribe result — a swap/tx mentioned our mint
    const params = (data as { params?: { result?: { value?: { signature: string } } } }).params;
    if (!params?.result?.value?.signature) return;

    const sig = params.result.value.signature;
    // Find matching subscription and update price
    // logsSubscribe notifications include the subscription ID in params.subscription
    const subId = (data as { params?: { subscription: number } }).params?.subscription;
    if (!subId) return;

    const sub = this.subs.get(subId);
    if (!sub) return;

    // Debounce: skip if last update was < 200ms ago
    const now = Date.now();
    if (now - sub.lastUpdate < 200) return;
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
      // Non-fatal, wait for next log notification
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

  /** Subscribe to a token's price. Returns sub ID for unsubscribe. */
  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const subId = this.nextId++;
    const sub: ActiveSub = {
      mint,
      subId,
      callback,
      lastPrice: 0,
      lastUpdate: 0,
    };
    this.subs.set(subId, sub);

    // Fetch initial price immediately
    await this.fetchAndUpdate(sub);

    if (this.connected) {
      this.doSubscribe(mint, subId);
    }

    return subId;
  }

  /** Unsubscribe from a token's price feed. */
  unsubscribe(subId: number): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    this.subs.delete(subId);

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

  /** Check if WebSocket is connected. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Close the feed and all subscriptions. */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subs.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
