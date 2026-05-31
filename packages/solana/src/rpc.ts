import { Connection, type Commitment } from "@solana/web3.js";

export function createConnection(rpcUrl: string, commitment: Commitment = "confirmed"): Connection {
  return new Connection(rpcUrl, commitment);
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;
