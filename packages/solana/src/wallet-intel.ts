import { Connection, PublicKey } from "@solana/web3.js";

export interface TokenBuyer {
  wallet: string;
  tokenDelta: number;
  ts: number;
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
  constructor(private readonly connection: Connection) {}

  async getRecentBuyers(mint: string, limit = 15): Promise<TokenBuyer[]> {
    try {
      return await Promise.race([
        this.fetchBuyers(mint, limit),
        new Promise<TokenBuyer[]>((resolve) =>
          setTimeout(() => resolve([]), 10_000),
        ),
      ]);
    } catch {
      return [];
    }
  }

  private async fetchBuyers(mint: string, limit: number): Promise<TokenBuyer[]> {
    const mintPk = new PublicKey(mint);
    const sigs = await this.connection.getSignaturesForAddress(mintPk, { limit });
    if (sigs.length === 0) return [];

    const buyers = new Map<string, TokenBuyer>();

    const txs = await Promise.all(
      sigs.slice(0, limit).map((s) =>
        this.connection
          .getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
          .catch(() => null),
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

        const preBal = pre.find(
          (p) => p.accountIndex === postBal.accountIndex,
        );
        const preAmt = preBal?.uiTokenAmount.uiAmount ?? 0;
        const postAmt = postBal.uiTokenAmount.uiAmount ?? 0;
        const delta = postAmt - preAmt;

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
