/**
 * Real-time price feed — pure Helius WebSocket, no aggregators:
 *
 *   1. accountSubscribe on pump.fun bonding-curve PDA
 *      → Decodes virtual reserves directly. Sub-100ms, exact on-chain price.
 *
 *   2. logsSubscribe with { mentions: [mint] }
 *      → Fires on EVERY swap/trade mentioning the token on ANY DEX.
 *      → Triggers an immediate Jupiter price fetch (debounced 50ms).
 *      → Covers ALL tokens, not just pump.fun.
 *
 *   3. Jupiter REST polling at 500ms
 *      → Fallback safety net when WS subscriptions fail.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { AccountInfo, Context, Logs } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const JUPITER_URL = "https://api.jup.ag/price/v2";
const JUPITER_POLL_MS = 500;
const DEBOUNCE_MS = 50;
const SOL_USD_FALLBACK = 130;
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  source: "ws-bonding-curve" | "ws-logs-trigger" | "jupiter-rest";
  /** Timestamp when this update was received (for latency measurement). */
  receivedAt?: number;
}

export type PriceCallback = (update: PriceUpdate) => void;

interface SubEntry {
  mint: string;
  callback: PriceCallback;
  accountSubId: number | null;
  logsSubId: number | null;
  jupiterTimer: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  pda: PublicKey | null;
  solUsd: number;
}

export class RealtimePriceFeed {
  private readonly connection: Connection;
  private subs = new Map<string, SubEntry>();
  private closed = false;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  get isConnected(): boolean {
    return !this.closed;
  }

  /**
   * Subscribe to real-time price updates for a token mint.
   * Layer 1: bonding-curve PDA (pump.fun) — sub-100ms, exact on-chain price.
   * Layer 2: logsSubscribe (all DEXes) — triggers price fetch on any trade.
   * Layer 3: Jupiter polling at 500ms — safety net.
   */
  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    if (this.subs.has(mint)) return 0;

    const entry: SubEntry = {
      mint,
      callback,
      accountSubId: null,
      logsSubId: null,
      jupiterTimer: null,
      debounceTimer: null,
      pda: null,
      solUsd: SOL_USD_FALLBACK,
    };
    this.subs.set(mint, entry);

    // Fetch live SOL/USD for bonding-curve MC calculation
    void this.fetchSolUsd(entry);

    // Immediate first price fetch
    void this.fetchJupiter(entry, "jupiter-rest");

    // Layer 1: accountSubscribe on pump.fun bonding-curve PDA
    try {
      const mintPk = new PublicKey(mint);
      const [pda] = PublicKey.findProgramAddressSync(
        [BONDING_CURVE_SEED, mintPk.toBuffer()],
        PUMP_PROGRAM,
      );
      entry.pda = pda;
      entry.accountSubId = this.connection.onAccountChange(
        pda,
        (accountInfo: AccountInfo<Buffer>, _ctx: Context) =>
          this.onBondingCurveUpdate(entry, accountInfo.data),
        "processed",
      );
    } catch {
      // PDA derivation failed — token may not be pump.fun
    }

    // Layer 2: logsSubscribe — fires on ANY swap/trade mentioning this token
    try {
      // @solana/web3.js v1 types don't expose LogsFilter, but RPC supports it
      entry.logsSubId = (this.connection.onLogs as Function)(
        { mentions: [mint] },
        { mentions: [mint] },
        (_logs: Logs, _ctx: Context) => this.onTradeDetected(entry),
        "processed",
      );
    } catch {
      // logsSubscribe failed — Jupiter polling covers it
    }

    // Layer 3: Jupiter polling at 500ms (always runs as safety net)
    entry.jupiterTimer = setInterval(() => {
      if (!this.subs.has(mint)) {
        clearInterval(entry.jupiterTimer!);
        return;
      }
      void this.fetchJupiter(entry, "jupiter-rest");
    }, JUPITER_POLL_MS);

    return 0;
  }

  unsubscribe(mint: string): void {
    const entry = this.subs.get(mint);
    if (!entry) return;
    this.subs.delete(mint);

    if (entry.accountSubId !== null) {
      this.connection.removeAccountChangeListener(entry.accountSubId).catch(() => {});
    }
    if (entry.logsSubId !== null) {
      this.connection.removeOnLogsListener(entry.logsSubId).catch(() => {});
    }
    if (entry.jupiterTimer) clearInterval(entry.jupiterTimer);
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  }

  close(): void {
    this.closed = true;
    for (const [mint] of this.subs) {
      this.unsubscribe(mint);
    }
  }

  /** Bonding-curve account changed → decode virtual reserves → push exact price. */
  private onBondingCurveUpdate(entry: SubEntry, data: Buffer): void {
    if (data.length < 48) return;
    const vt = Number(data.readBigUInt64LE(8));
    const vs = Number(data.readBigUInt64LE(16));
    const supply = Number(data.readBigUInt64LE(40));
    if (vt <= 0 || vs <= 0) return;

    const priceSol = vs / vt;
    const priceUsd = priceSol * entry.solUsd;
    const mcUsd = supply > 0 ? priceSol * entry.solUsd * (supply / 1e6) : undefined;

    entry.callback({
      priceUsd,
      marketCapUsd: mcUsd,
      source: "ws-bonding-curve",
      receivedAt: Date.now(),
    });
  }

  /**
   * A swap/trade mentioning this token just landed on-chain.
   * Debounce 50ms to batch rapid trades, then fetch the latest Jupiter price.
   */
  private onTradeDetected(entry: SubEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      void this.fetchJupiter(entry, "ws-logs-trigger");
    }, DEBOUNCE_MS);
  }

  private async fetchJupiter(
    entry: SubEntry,
    source: "jupiter-rest" | "ws-logs-trigger",
  ): Promise<void> {
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
      entry.callback({
        priceUsd: p,
        marketCapUsd: d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined,
        source,
        receivedAt: Date.now(),
      });
    } catch {
      // Non-fatal — next event or poll will retry
    }
  }

  private async fetchSolUsd(entry: SubEntry): Promise<void> {
    try {
      const r = await fetch(
        `${JUPITER_URL}?ids=So11111111111111111111111111111111111111112`,
      );
      if (!r.ok) return;
      const j = (await r.json()) as { data?: Record<string, { price: string }> };
      const p = parseFloat(
        j.data?.["So11111111111111111111111111111111111111112"]?.price ?? "",
      );
      if (p > 0) entry.solUsd = p;
    } catch {
      // Keep default
    }
  }
}

/**
 * Backward-compatible wrapper around the legacy (priceUsd, marketCapUsd, meta?) signature.
 */
export class HeliusPriceFeed {
  private feed: RealtimePriceFeed | null = null;

  constructor() {}

  setConnection(connection: Connection): void {
    this.feed = new RealtimePriceFeed(connection);
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
    // No connection → standalone Jupiter polling
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
    }, JUPITER_POLL_MS);
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
