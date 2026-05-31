/**
 * On-chain safety checks via Solana RPC. Reads the SPL mint account directly
 * and parses authority flags — this is the single most important rug signal
 * (a live mint authority means the dev can print unlimited supply).
 *
 * SPL Mint account layout (165 bytes, packed LE):
 *   [0..4)   mintAuthorityOption (u32) — 1 if present
 *   [4..36)  mintAuthority (Pubkey)
 *   [36..44) supply (u64)
 *   [44]     decimals (u8)
 *   [45]     isInitialized (u8)
 *   [46..50) freezeAuthorityOption (u32) — 1 if present
 *   [50..82) freezeAuthority (Pubkey)
 */

import { Connection, PublicKey } from "@solana/web3.js";

export interface MintAuthorityInfo {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  supply: bigint;
  decimals: number;
  /** True if the account was found and parsed; false on RPC/parse failure. */
  resolved: boolean;
}

export async function checkMintAuthorities(
  connection: Connection,
  mint: string,
): Promise<MintAuthorityInfo> {
  const fallback: MintAuthorityInfo = {
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    supply: 0n,
    decimals: 0,
    resolved: false,
  };
  try {
    const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
    if (!info || info.data.length < 82) return fallback;
    const data = info.data;

    const mintAuthOption = data.readUInt32LE(0);
    const decimals = data.readUInt8(44);
    const freezeAuthOption = data.readUInt32LE(46);

    let supply = 0n;
    for (let i = 0; i < 8; i++) {
      supply |= BigInt(data[36 + i] ?? 0) << BigInt(8 * i);
    }

    return {
      mintAuthorityRevoked: mintAuthOption === 0,
      freezeAuthorityRevoked: freezeAuthOption === 0,
      supply,
      decimals,
      resolved: true,
    };
  } catch {
    return fallback;
  }
}
