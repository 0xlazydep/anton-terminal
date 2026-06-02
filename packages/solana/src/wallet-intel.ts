import { Connection, PublicKey } from "@solana/web3.js";

export interface TokenBuyer {
  wallet: string;
  tokenDelta: number;
  ts: number;
}

export interface WalletIntelResult {
  buyers: TokenBuyer[];
  smartBuyers: string[];
  bundledCount: number;
  freshWalletCount: number;
  rateLimited: boolean;
}

const KNOWN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
]);

export class WalletIntel {
  private rateLimitHits = 0;
  private lastRateLimitLog = 0;
  private readonly onRateLimit?: () => void;

  constructor(
    private readonly connection: Connection,
    onRateLimit?: () => void,
  ) {
    this.onRateLimit = onRateLimit;
  }

  /**
   * Full wallet intelligence scan: gets buyers, detects bundles (same funder),
   * checks wallet freshness, and identifies smart money.
   */
  async analyze(mint: string, smartScores: Map<string, number>): Promise<WalletIntelResult> {
    const empty: WalletIntelResult = {
      buyers: [], smartBuyers: [], bundledCount: 0, freshWalletCount: 0, rateLimited: false,
    };

    try {
      const result = await Promise.race([
        this.doAnalyze(mint, smartScores),
        new Promise<WalletIntelResult>((resolve) =>
          setTimeout(() => resolve({ ...empty, rateLimited: false }), 12_000),
        ),
      ]);
      return result;
    } catch (err: unknown) {
      this.logRateLimit(err);
      return { ...empty, rateLimited: this.isRateLimit(err) };
    }
  }

  private async doAnalyze(mint: string, smartScores: Map<string, number>): Promise<WalletIntelResult> {
    const mintPk = new PublicKey(mint);
    const sigs = await this.connection.getSignaturesForAddress(mintPk, { limit: 20 });
    if (sigs.length === 0) {
      return { buyers: [], smartBuyers: [], bundledCount: 0, freshWalletCount: 0, rateLimited: false };
    }

    // Fetch transactions
    const txs = await Promise.all(
      sigs.slice(0, 20).map((s) =>
        this.connection
          .getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
          .catch((err: unknown) => (this.logRateLimit(err), null)),
      ),
    );

    // Extract buyers + their funders
    const buyers = new Map<string, TokenBuyer>();
    const funders = new Map<string, string>(); // wallet → funder

    for (const tx of txs) {
      if (!tx?.meta) continue;
      const ts = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;

      // Detect funder (signer that paid SOL)
      const signers = tx.transaction.message.accountKeys
        .filter((k, i) => k.signer && tx.meta?.preBalances?.[i] !== undefined)
        .map((k) => k.pubkey.toBase58());
      const mainFunder = signers[0];

      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];

      for (const postBal of post) {
        if (postBal.mint !== mint) continue;
        const owner = postBal.owner;
        if (!owner || KNOWN_PROGRAMS.has(owner)) continue;

        const preBal = pre.find((p) => p.accountIndex === postBal.accountIndex);
        const delta = (postBal.uiTokenAmount.uiAmount ?? 0) - (preBal?.uiTokenAmount.uiAmount ?? 0);

        if (delta > 0) {
          const existing = buyers.get(owner);
          if (!existing || ts > existing.ts) {
            buyers.set(owner, { wallet: owner, tokenDelta: delta, ts });
          }
          if (mainFunder && mainFunder !== owner) {
            funders.set(owner, mainFunder);
          }
        }
      }
    }

    // Detect bundles: wallets funded by same source
    const funderCounts = new Map<string, number>();
    for (const f of funders.values()) {
      funderCounts.set(f, (funderCounts.get(f) ?? 0) + 1);
    }
    const bundledCount = [...funderCounts.values()].filter((c) => c >= 3).length;

    // Detect fresh wallets (< 10 txns)
    let freshWalletCount = 0;
    const walletList = [...buyers.keys()];
    for (let i = 0; i < Math.min(walletList.length, 5); i++) {
      try {
        const wSigs = await this.connection.getSignaturesForAddress(
          new PublicKey(walletList[i]!),
          { limit: 10 },
        );
        if (wSigs.length < 5) freshWalletCount++;
      } catch {
        // skip
      }
    }

    // Smart money check
    const smartBuyers = walletList.filter((w) => (smartScores.get(w) ?? 0.5) > 0.6);

    return {
      buyers: [...buyers.values()],
      smartBuyers,
      bundledCount,
      freshWalletCount,
      rateLimited: false,
    };
  }

  private isRateLimit(err: unknown): boolean {
    const msg = String(err);
    return msg.includes("429") || msg.includes("rate limit") || msg.includes("Too Many Requests");
  }

  private logRateLimit(err: unknown): void {
    if (!this.isRateLimit(err)) return;
    this.rateLimitHits++;
    const now = Date.now();
    if (now - this.lastRateLimitLog > 60_000) {
      this.lastRateLimitLog = now;
      process.stderr.write(`[wallet-intel] ⚠ RATE LIMIT HIT #${this.rateLimitHits}: Helius API limit reached — consider switching API key\n`);
      this.onRateLimit?.();
    }
  }

  /**
   * Legacy method for backward compat — returns just buyers array.
   */
  async getRecentBuyers(mint: string, limit = 15): Promise<TokenBuyer[]> {
    try {
      return await Promise.race([
        this.fetchBuyersOnly(mint, limit),
        new Promise<TokenBuyer[]>((r) => setTimeout(() => r([]), 10_000)),
      ]);
    } catch {
      return [];
    }
  }

  private async fetchBuyersOnly(mint: string, limit: number): Promise<TokenBuyer[]> {
    const sigs = await this.connection.getSignaturesForAddress(new PublicKey(mint), { limit });
    if (sigs.length === 0) return [];
    const buyers = new Map<string, TokenBuyer>();
    const txs = await Promise.all(
      sigs.slice(0, limit).map((s) =>
        this.connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null),
      ),
    );
    for (const tx of txs) {
      if (!tx?.meta) continue;
      const ts = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];
      for (const postBal of post) {
        if (postBal.mint !== mint) continue;
        const owner = postBal.owner;
        if (!owner || KNOWN_PROGRAMS.has(owner)) continue;
        const preBal = pre.find((p) => p.accountIndex === postBal.accountIndex);
        const delta = (postBal.uiTokenAmount.uiAmount ?? 0) - (preBal?.uiTokenAmount.uiAmount ?? 0);
        if (delta > 0) {
          const existing = buyers.get(owner);
          if (!existing || ts > existing.ts) {
            buyers.set(owner, { wallet: owner, tokenDelta: delta, ts });
          }
        }
      }
    }
    return [...buyers.values()];
  }
}
