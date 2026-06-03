/**
 * Real-time price feed — three independent sources, first to fire wins:
 *
 *   1. Birdeye WebSocket (wss://ws.birdeye.so)
 *      → Pushes prices for ALL Solana tokens at validator propagation speed.
 *      → Single shared connection, multiplexes all subscriptions.
 *
 *   2. Helius WebSocket `accountSubscribe` on pump.fun bonding-curve PDA
 *      → Sub-100ms for pump.fun tokens specifically.
 *
 *   3. Jupiter REST at 200ms
 *      → Fallback when both WebSockets miss a token.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import WebSocket from "ws";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const BIRDEYE_WS = "wss://ws.birdeye.so";
const JUPITER_URL = "https://api.jup.ag/price/v2";
const JUPITER_MS = 200;
const SOL_USD_FALLBACK = 130;
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  source: "birdeye-ws" | "ws-bonding-curve" | "jupiter-rest";
  latencyMs?: number;
}

export type PriceCallback = (update: PriceUpdate) => void;

interface SubEntry {
  mint: string;
  callback: PriceCallback;
  wsSubId: number | null;
  jupiterTimer: ReturnType<typeof setInterval> | null;
  pda: PublicKey | null;
  solUsd: number;
}

/**
 * Birdeye WebSocket — single shared connection, multiplexed subscriptions.
 * Birdeye aggregates DEX data at validator speed and pushes sub-50ms price
 * updates for EVERY Solana token. This is how GMGN/Axiom get their speed.
 */
class BirdeyeWs {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private callbacks = new Map<string, Set<PriceCallback>>();
  private pending: Array<() => void> = [];
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.connect();
  }

  subscribe(mint: string, cb: PriceCallback): void {
    let set = this.callbacks.get(mint);
    if (!set) {
      set = new Set();
      this.callbacks.set(mint, set);
    }
    set.add(cb);

    if (this.connected) {
      this.sendSubscribe(mint);
    } else {
      this.pending.push(() => this.sendSubscribe(mint));
    }
  }

  unsubscribe(mint: string, cb?: PriceCallback): void {
    const set = this.callbacks.get(mint);
    if (!set) return;
    if (cb) {
      set.delete(cb);
      if (set.size > 0) return;
    }
    this.callbacks.delete(mint);
    if (this.connected) {
      this.ws?.send(JSON.stringify({
        type: "UNSUBSCRIBE_PRICE",
        data: { queryType: "simple", address: mint },
      }));
    }
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.connected = false;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(BIRDEYE_WS);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.ws!.send(JSON.stringify({
        type: "CONNECT",
        data: { apiKey: this.apiKey },
      }));
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          data?: { address?: string; value?: number; marketCap?: number };
        };
        if (msg.type === "CONNECTED") {
          this.connected = true;
          this.flushPending();
          process.stderr.write(`[birdeye] connected — real-time price feed active\n`);
          return;
        }
        if (msg.type === "PRICE_DATA" && msg.data?.address) {
          const addr = msg.data.address;
          const cbs = this.callbacks.get(addr);
          if (!cbs) return;
          const update: PriceUpdate = {
            priceUsd: msg.data.value ?? 0,
            marketCapUsd: msg.data.marketCap,
            source: "birdeye-ws",
            latencyMs: Date.now(),
          };
          for (const cb of cbs) {
            cb(update);
          }
        }
      } catch { /* malformed frame */ }
    });

    this.ws.on("close", () => {
      this.connected = false;
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.ws?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private sendSubscribe(mint: string): void {
    this.ws?.send(JSON.stringify({
      type: "SUBSCRIBE_PRICE",
      data: { queryType: "simple", address: mint },
    }));
  }

  private flushPending(): void {
    for (const fn of this.pending) fn();
    this.pending.length = 0;
  }
}

export class RealtimePriceFeed {
  private connection: Connection | null;
  private birdeye: BirdeyeWs | null;
  private subs = new Map<string, SubEntry>();
  private closed = false;

  constructor(connection?: Connection, birdeyeApiKey?: string) {
    this.connection = connection ?? null;
    this.birdeye = birdeyeApiKey ? new BirdeyeWs(birdeyeApiKey) : null;
  }

  get isConnected(): boolean {
    return !this.closed;
  }

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    if (this.subs.has(mint)) return 0;

    const entry: SubEntry = {
      mint,
      callback,
      wsSubId: null,
      jupiterTimer: null,
      pda: null,
      solUsd: SOL_USD_FALLBACK,
    };
    this.subs.set(mint, entry);

    // Fetch SOL/USD for bonding-curve price conversion
    void this.fetchSolUsd(entry);

    // Layer 1: Birdeye WebSocket — real-time prices for ALL tokens (validator speed)
    this.birdeye?.subscribe(mint, (update) => {
      if (update.priceUsd > 0) callback(update);
    });

    // Layer 2: Helius WebSocket on pump.fun bonding curve
    if (this.connection) {
      try {
        const mintPk = new PublicKey(mint);
        const [pda] = PublicKey.findProgramAddressSync(
          [BONDING_CURVE_SEED, mintPk.toBuffer()],
          PUMP_PROGRAM,
        );
        entry.pda = pda;

        entry.wsSubId = this.connection.onAccountChange(
          pda,
          (accountInfo) => this.onBondingCurveUpdate(entry, accountInfo.data),
          "processed",
        );
      } catch {
        // PDA derivation failed — handled by Birdeye
      }
    }

    // Layer 3: Jupiter REST at 200ms (always runs as safety net)
    void this.fetchJupiter(entry);
    entry.jupiterTimer = setInterval(() => {
      if (!this.subs.has(mint)) {
        clearInterval(entry.jupiterTimer!);
        return;
      }
      void this.fetchJupiter(entry);
    }, JUPITER_MS);

    return 0;
  }

  unsubscribe(mint: string): void {
    const entry = this.subs.get(mint);
    if (!entry) return;
    this.subs.delete(mint);

    this.birdeye?.unsubscribe(mint);
    if (entry.wsSubId !== null && this.connection) {
      this.connection.removeAccountChangeListener(entry.wsSubId).catch(() => {});
    }
    if (entry.jupiterTimer) clearInterval(entry.jupiterTimer);
  }

  close(): void {
    this.closed = true;
    for (const [mint] of this.subs) {
      this.unsubscribe(mint);
    }
    this.birdeye?.close();
  }

  private onBondingCurveUpdate(entry: SubEntry, data: Buffer): void {
    if (data.length < 48) return;
    const vt = Number(data.readBigUInt64LE(8));
    const vs = Number(data.readBigUInt64LE(16));
    const supply = Number(data.readBigUInt64LE(40));
    if (vt <= 0 || vs <= 0) return;

    const priceSol = vs / vt;
    const priceUsd = priceSol * entry.solUsd;
    const mcUsd = supply > 0 ? priceSol * entry.solUsd * (supply / 1e6) : undefined;

    entry.callback({ priceUsd, marketCapUsd: mcUsd, source: "ws-bonding-curve" });
  }

  private async fetchJupiter(entry: SubEntry): Promise<void> {
    try {
      const r = await fetch(`${JUPITER_URL}?ids=${entry.mint}&showExtraInfo=true`);
      if (!r.ok) return;
      const j = (await r.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const d = j.data?.[entry.mint];
      if (!d) return;
      const p = parseFloat(d.price) || 0;
      if (p <= 0) return;
      entry.callback({ priceUsd: p, marketCapUsd: d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined, source: "jupiter-rest" });
    } catch { /* non-fatal */ }
  }

  private async fetchSolUsd(entry: SubEntry): Promise<void> {
    try {
      const r = await fetch(`${JUPITER_URL}?ids=So11111111111111111111111111111111111111112`);
      if (!r.ok) return;
      const j = (await r.json()) as { data?: Record<string, { price: string }> };
      const p = parseFloat(j.data?.["So11111111111111111111111111111111111111112"]?.price ?? "");
      if (p > 0) entry.solUsd = p;
    } catch { /* keep default */ }
  }
}

/**
 * @deprecated Use RealtimePriceFeed directly.
 * Backward-compatible wrapper around the legacy callback signature.
 */
export class HeliusPriceFeed {
  private feed: RealtimePriceFeed | null = null;

  constructor(_wsUrl?: string) {}

  setConnection(connection: Connection, solUsdPrice?: number, birdeyeApiKey?: string): void {
    this.feed = new RealtimePriceFeed(connection, birdeyeApiKey);
  }

  async subscribe(
    mint: string,
    legacyCb: (priceUsd: number, marketCapUsd?: number, meta?: { source: string }) => void,
  ): Promise<number> {
    if (this.feed) {
      return this.feed.subscribe(mint, (update) => {
        legacyCb(update.priceUsd, update.marketCapUsd, { source: update.source });
      });
    }
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${JUPITER_URL}?ids=${mint}&showExtraInfo=true`);
        if (!r.ok) return;
        const j = (await r.json()) as {
          data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
        };
        const d = j.data?.[mint];
        if (!d) return;
        const p = parseFloat(d.price) || 0;
        if (p <= 0) return;
        legacyCb(p, d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined, {
          source: "jupiter",
        });
      } catch {}
    }, JUPITER_MS);
    return 0;
  }

  unsubscribe(mint: string): void {
    this.feed?.unsubscribe(mint);
  }

  get isConnected(): boolean {
    return this.feed?.isConnected ?? true;
  }

  close(): void {
    this.feed?.close();
  }
}
