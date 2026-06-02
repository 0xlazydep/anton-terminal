import { eq, inArray, sql, gt } from "drizzle-orm";
import type { Database } from "../db.js";
import { smartWallets, walletSwaps } from "../schema/learning.js";

export async function upsertWalletScore(
  db: Database,
  input: { address: string; trustDelta: number },
): Promise<void> {
  const existing = await db
    .select({ trust: smartWallets.trust })
    .from(smartWallets)
    .where(eq(smartWallets.address, input.address))
    .limit(1);

  if (existing.length > 0) {
    const current = existing[0]!.trust ?? 0.5;
    const next = Math.max(0, Math.min(1, current + input.trustDelta));
    await db
      .update(smartWallets)
      .set({ trust: next, lastEvaluated: sql`now()` })
      .where(eq(smartWallets.address, input.address));
  } else {
    await db
      .insert(smartWallets)
      .values({
        address: input.address,
        trust: Math.max(0, Math.min(1, 0.5 + input.trustDelta)),
      })
      .onConflictDoNothing({ target: smartWallets.address });
  }
}

export async function ensureWallet(db: Database, address: string): Promise<void> {
  await db
    .insert(smartWallets)
    .values({ address, trust: 0.5 })
    .onConflictDoNothing({ target: smartWallets.address });
}

export async function getWalletScores(
  db: Database,
  addresses: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (addresses.length === 0) return result;

  const rows = await db
    .select({ address: smartWallets.address, trust: smartWallets.trust })
    .from(smartWallets)
    .where(inArray(smartWallets.address, addresses));

  for (const r of rows) {
    result.set(r.address, r.trust ?? 0.5);
  }
  return result;
}

export async function recordWalletSwap(
  db: Database,
  input: {
    wallet: string;
    mint: string;
    side: "BUY" | "SELL";
    tokenAmount: number;
    ts: number;
  },
): Promise<void> {
  await ensureWallet(db, input.wallet);
  await db
    .insert(walletSwaps)
    .values({
      wallet: input.wallet,
      mint: input.mint,
      side: input.side,
      tokenAmount: input.tokenAmount,
      ts: new Date(input.ts),
    })
    .onConflictDoNothing();
}

export async function getWalletsForMint(
  db: Database,
  mint: string,
): Promise<string[]> {
  const rows = await db
    .select({ wallet: walletSwaps.wallet })
    .from(walletSwaps)
    .where(eq(walletSwaps.mint, mint));
  return [...new Set(rows.map((r) => r.wallet))];
}

export async function getSmartWalletCount(db: Database): Promise<number> {
  const rows = await db
    .select({ address: smartWallets.address })
    .from(smartWallets)
    .where(gt(smartWallets.trust, 0.6));
  return rows.length;
}
