import { Connection, PublicKey } from "@solana/web3.js";

export interface TokenBalance {
  rawAmount: string;
  decimals: number;
  uiAmount: number;
}

export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: string,
): Promise<TokenBalance | null> {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(mint),
  });
  let rawTotal = 0n;
  let decimals = 0;
  for (const { account } of accounts.value) {
    const info = account.data.parsed?.info?.tokenAmount;
    if (!info) continue;
    rawTotal += BigInt(info.amount);
    decimals = info.decimals;
  }
  if (rawTotal === 0n) return null;
  return {
    rawAmount: rawTotal.toString(),
    decimals,
    uiAmount: Number(rawTotal) / 10 ** decimals,
  };
}
