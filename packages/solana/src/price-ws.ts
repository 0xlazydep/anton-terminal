/**
 * Real-time price feed for Solana meme coins.
 *
 *   1. accountSubscribe on pump.fun bonding-curve PDA (Helius WS)
 *      → Sub-100ms push, exact on-chain price. Same data GMGN reads.
 *
 *   2. GMGN OpenAPI poll at 1s (when GMGN_API_KEY is set)
 *      → price + market cap that match the GMGN UI exactly.
 *
 *   3. Jupiter REST poll at 1s (fallback when GMGN unavailable)
 *
 * Bonding-curve account layout (pump.fun):
 *   offset  8 → virtualTokenReserves (u64, 6 decimals)
 *   offset 16 → virtualSolReserves   (u64, 9 decimals / lamports)
 *   offset 40 → tokenTotalSupply     (u64, 6 decimals)
 *
 * priceSol = (virtualSolReserves / 1e9) / (virtualTokenReserves / 1e6)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { AccountInfo, Context } from "@solana/web3.js";
import { GmgnClient } from "./gmgn.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const JUPITER_URL = "https://api.jup.ag/price/v2";
const POLL_MS = 1000;
const SOL_USD_FALLBACK = 130;
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

export interface PriceUpdate {
  priceUsd: number;
  marketCapUsd?: number;
  source: "ws-bonding-curve" | "gmgn-api" | "jupiter-rest";
  receivedAt?: number;
}

export type PriceCallback = (update: PriceUpdate) => void;

interface SubEntry {
  mint: string;
  callback: PriceCallback;
  accountSubId: number | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  pda: PublicKey | null;
  solUsd: number;
}

export class RealtimePriceFeed {
  private readonly connection: Connection;
  private readonly gmgn: GmgnClient | null;
  private subs = new Map<string, SubEntry>();
  private closed = false;

  constructor(connection: Connection, gmgnApiKey?: string) {
    this.connection = connection;
    this.gmgn = gmgnApiKey ? new GmgnClient(gmgnApiKey) : null;
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
      pollTimer: null,
      pda: null,
      solUsd: SOL_USD_FALLBACK,
    };
    this.subs.set(mint, entry);

    void this.fetchSolUsd(entry);
    void this.poll(entry);

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
      process.stderr.write(`[feed] bonding-curve WS active for ${mint.slice(0, 8)}\n`);
    } catch {
      process.stderr.write(`[feed] bonding-curve WS failed for ${mint.slice(0, 8)}\n`);
    }

    entry.pollTimer = setInterval(() => {
      if (!this.subs.has(mint)) {
        clearInterval(entry.pollTimer!);
        return;
      }
      void this.poll(entry);
    }, POLL_MS);

    return 0;
  }

  unsubscribe(mint: string): void {
    const entry = this.subs.get(mint);
    if (!entry) return;
    this.subs.delete(mint);

    if (entry.accountSubId !== null) {
      this.connection.removeAccountChangeListener(entry.accountSubId).catch(() => {});
    }
    if (entry.pollTimer) clearInterval(entry.pollTimer);
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
    const totalSupply = Number(data.readBigUInt64LE(40));
    if (vt <= 0 || vs <= 0) return;

    const priceSol = vs / 1e9 / (vt / 1e6);
    const priceUsd = priceSol * entry.solUsd;
    if (priceUsd <= 0) return;

    const mcUsd = totalSupply > 0 ? priceUsd * (totalSupply / 1e6) : undefined;

    entry.callback({
      priceUsd,
      marketCapUsd: mcUsd,
      source: "ws-bonding-curve",
      receivedAt: Date.now(),
    });
  }

  private async poll(entry: SubEntry): Promise<void> {
    // Prefer GMGN — its price/MC matches the GMGN UI exactly
    if (this.gmgn) {
      const g = await this.gmgn.fetchTokenInfo(entry.mint);
      if (g && g.priceUsd > 0) {
        entry.callback({
          priceUsd: g.priceUsd,
          marketCapUsd: g.marketCapUsd,
          source: "gmgn-api",
          receivedAt: Date.now(),
        });
        return;
      }
    }
    await this.fetchJupiter(entry);
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
 * Backward-compatible wrapper around the legacy callback signature.
 */
export class HeliusPriceFeed {
  private feed: RealtimePriceFeed | null = null;

  constructor() {}

  setConnection(connection: Connection, gmgnApiKey?: string): void {
    this.feed = new RealtimePriceFeed(connection, gmgnApiKey);
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
    }, POLL_MS);
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
