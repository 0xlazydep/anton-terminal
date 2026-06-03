/**
 * Real-time price feed with three layers:
 *   1. Helius WebSocket `accountSubscribe` on pump.fun bonding-curve PDA
 *      → sub-100ms price updates (every buy/sell triggers a push)
 *   2. Jupiter REST API at 500ms → fallback for graduated / non-pump tokens
 *   3. DexScreener → MC-only backup (handled by the screening poll timer)
 *
 * Pump.fun bonding-curve PDA layout (same as fetchBondingCurvePrice in agent):
 *   offset  8 → virtualTokenReserves (u64 LE)
 *   offset 16 → virtualSolReserves   (u64 LE)
 *   offset 40 → realTokenReserves    (u64 LE) — total supply, for MC
 *
 * Price in SOL = virtualSolReserves / virtualTokenReserves.
 * Market cap   = priceSol * solUsdPrice * (realTokenReserves / 1e6).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { Context, AccountInfo } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const JUPITER_FALLBACK_MS = 500;
const SOL_USD_FALLBACK = 130;
const ACCOUNT_DATA_MIN_LEN = 48;

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  /** "ws-bonding-curve" | "jupiter-rest" | "dexscreener" */
  source: "ws-bonding-curve" | "jupiter-rest" | "dexscreener";
  /** ms since last update (approximate latency from chain to callback) */
  latencyMs?: number;
}

export type PriceCallback = (update: PriceUpdate) => void;

interface SubEntry {
  mint: string;
  callback: PriceCallback;
  wsSubId: number | null;
  jupiterTimer: ReturnType<typeof setInterval> | null;
  lastUpdateTs: number;
}

export class RealtimePriceFeed {
  private readonly connection: Connection;
  private readonly solUsdPrice: number;
  private subs = new Map<string, SubEntry>();
  private reconnectAttempts = 0;
  private closed = false;

  constructor(connection: Connection, solUsdPrice = SOL_USD_FALLBACK) {
    this.connection = connection;
    this.solUsdPrice = solUsdPrice;
  }

  /**
   * Subscribe to real-time price updates for a token mint.
   * Returns 0 on success. Falls back to Jupiter polling if the bonding-curve
   * PDA does not exist (graduated tokens, non-pump tokens).
   */
  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    const entry: SubEntry = {
      mint,
      callback,
      wsSubId: null,
      jupiterTimer: null,
      lastUpdateTs: 0,
    };

    // Immediate first fetch via Jupiter (no waiting for next WS push or poll tick)
    void this.fetchJupiter(mint, callback, "jupiter-rest");

    // Try pump.fun bonding-curve WebSocket subscription
    try {
      const mintPk = new PublicKey(mint);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mintPk.toBuffer()],
        PUMP_PROGRAM,
      );

      const subId = this.connection.onAccountChange(
        pda,
        (accountInfo: AccountInfo<Buffer>, _ctx: Context) => {
          const update = this.decodeBondingCurve(accountInfo.data);
          if (update) {
            entry.lastUpdateTs = Date.now();
            callback(update);
          }
        },
        "processed",
      );

      entry.wsSubId = subId;
    } catch {
      // PDA derivation or subscription failed — Jupiter polling only
    }

    // Jupiter REST fallback at 500ms (runs even when WS is active as safety net)
    entry.jupiterTimer = setInterval(() => {
      void this.fetchJupiter(mint, callback, "jupiter-rest");
    }, JUPITER_FALLBACK_MS);

    this.subs.set(mint, entry);
    return 0;
  }

  unsubscribe(mint: string): void {
    const entry = this.subs.get(mint);
    if (!entry) return;

    if (entry.wsSubId !== null) {
      void this.connection.removeAccountChangeListener(entry.wsSubId).catch(() => {});
    }
    if (entry.jupiterTimer !== null) {
      clearInterval(entry.jupiterTimer);
    }
    this.subs.delete(mint);
  }

  get isConnected(): boolean {
    return !this.closed;
  }

  /** Number of tokens subscribed via WebSocket (not Jupiter fallback). */
  get wsSubCount(): number {
    let count = 0;
    for (const entry of this.subs.values()) {
      if (entry.wsSubId !== null) count++;
    }
    return count;
  }

  close(): void {
    this.closed = true;
    for (const [mint] of this.subs) {
      this.unsubscribe(mint);
    }
  }

  private decodeBondingCurve(data: Buffer): PriceUpdate | null {
    if (data.length < ACCOUNT_DATA_MIN_LEN) return null;

    const vt = Number(data.readBigUInt64LE(8));
    const vs = Number(data.readBigUInt64LE(16));
    const realSupply = Number(data.readBigUInt64LE(40));

    if (vt <= 0 || vs <= 0) return null;

    const priceSol = vs / 1e9 / (vt / 1e6);
    const priceUsd = priceSol * this.solUsdPrice;
    if (priceUsd <= 0) return null;

    const mcUsd = realSupply > 0 ? priceUsd * (realSupply / 1e6) : undefined;

    return {
      priceUsd,
      marketCapUsd: mcUsd,
      source: "ws-bonding-curve",
      latencyMs: undefined,
    };
  }

  private async fetchJupiter(
    mint: string,
    callback: PriceCallback,
    source: "jupiter-rest" | "dexscreener",
  ): Promise<void> {
    try {
      const r = await fetch(
        `https://api.jup.ag/price/v2?ids=${mint}&showExtraInfo=true`,
      );
      if (!r.ok) return;
      const j = (await r.json()) as {
        data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
      };
      const d = j.data?.[mint];
      if (!d) return;
      const priceUsd = parseFloat(d.price) || 0;
      if (priceUsd <= 0) return;

      callback({
        priceUsd,
        marketCapUsd: d.extraInfo?.marketCap
          ? parseFloat(d.extraInfo.marketCap)
          : undefined,
        source,
        latencyMs: undefined,
      });
    } catch {
      // Silent — Jupiter is a fallback, failures are non-fatal
    }
  }
}

/**
 * @deprecated Use RealtimePriceFeed instead.
 * Kept for backward compatibility. Wraps the old callback signature.
 */
export class HeliusPriceFeed {
  private feed: RealtimePriceFeed | null = null;

  constructor(_wsUrl?: string) {
    // No-op: legacy constructor. Use setConnection() to activate real feed,
    // or fall back to standalone Jupiter polling.
  }

  /** Activate real-time WebSocket feed. Call before subscribe(). */
  setConnection(connection: Connection, solUsdPrice?: number): void {
    this.feed = new RealtimePriceFeed(connection, solUsdPrice);
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

    // Standalone Jupiter polling (no Connection provided) — keep legacy behavior
    const interval = setInterval(async () => {
      try {
        const r = await fetch(
          `https://api.jup.ag/price/v2?ids=${mint}&showExtraInfo=true`,
        );
        if (!r.ok) return;
        const j = (await r.json()) as {
          data?: Record<string, { price: string; extraInfo?: { marketCap?: string } }>;
        };
        const d = j.data?.[mint];
        if (!d) return;
        const priceUsd = parseFloat(d.price) || 0;
        if (priceUsd <= 0) return;
        legacyCb(priceUsd, d.extraInfo?.marketCap
          ? parseFloat(d.extraInfo.marketCap)
          : undefined, { source: "jupiter" });
      } catch {}
    }, JUPITER_FALLBACK_MS);

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
