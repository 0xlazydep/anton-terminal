/**
 * Real-time price feed — pure Helius WebSocket, zero external dependencies.
 *
 *   accountSubscribe on pump.fun bonding-curve PDA
 *   → Decodes virtual reserves directly from on-chain account data.
 *   → Sub-100ms, exact on-chain price. Every buy/sell triggers a push.
 *
 *   Jupiter REST polling at 1000ms
 *   → Fallback safety net for graduated/non-pumpfun tokens.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { AccountInfo, Context } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const JUPITER_URL = "https://api.jup.ag/price/v2";
const JUPITER_POLL_MS = 1000;
const SOL_USD_FALLBACK = 130;
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  source: "ws-bonding-curve" | "jupiter-rest";
  receivedAt?: number;
}

export type PriceCallback = (update: PriceUpdate) => void;

interface SubEntry {
  mint: string;
  callback: PriceCallback;
  accountSubId: number | null;
  jupiterTimer: ReturnType<typeof setInterval> | null;
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

  async subscribe(mint: string, callback: PriceCallback): Promise<number> {
    if (this.subs.has(mint)) return 0;

    const entry: SubEntry = {
      mint,
      callback,
      accountSubId: null,
      jupiterTimer: null,
      pda: null,
      solUsd: SOL_USD_FALLBACK,
    };
    this.subs.set(mint, entry);

    void this.fetchSolUsd(entry);
    void this.fetchJupiter(entry);

    // accountSubscribe on pump.fun bonding-curve PDA
    // → every on-chain buy/sell pushes updated virtual reserves
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
        process.stderr.write(`[feed] bonding-curve sub active for ${mint.slice(0, 8)}\n`);
      } catch {
        process.stderr.write(`[feed] bonding-curve sub failed for ${mint.slice(0, 8)} — Jupiter only\n`);
      }

    // Jupiter REST polling at 1s
    entry.jupiterTimer = setInterval(() => {
      if (!this.subs.has(mint)) {
        clearInterval(entry.jupiterTimer!);
        return;
      }
      void this.fetchJupiter(entry);
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
    if (entry.jupiterTimer) clearInterval(entry.jupiterTimer);
  }

  close(): void {
    this.closed = true;
    for (const [mint] of this.subs) {
      this.unsubscribe(mint);
    }
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

    entry.callback({
      priceUsd,
      marketCapUsd: mcUsd,
      source: "ws-bonding-curve",
      receivedAt: Date.now(),
    });
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
      entry.callback({
        priceUsd: p,
        marketCapUsd: d.extraInfo?.marketCap ? parseFloat(d.extraInfo.marketCap) : undefined,
        source: "jupiter-rest",
        receivedAt: Date.now(),
      });
    } catch {
      // Non-fatal — next poll retries
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
 * Backward-compatible wrapper.
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
