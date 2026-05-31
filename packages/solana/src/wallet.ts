import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function loadHotWallet(base58Key: string | undefined): Keypair {
  if (!base58Key) {
    throw new Error("SOLANA_PRIVATE_KEY is not set; cannot load hot wallet");
  }
  return Keypair.fromSecretKey(bs58.decode(base58Key));
}
