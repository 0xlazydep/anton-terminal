import { Connection, type Commitment } from "@solana/web3.js";

export function createConnection(rpcUrl: string, commitment: Commitment = "confirmed"): Connection {
  return new Connection(rpcUrl, commitment);
}

/**
 * Create a Solana Connection with a dedicated WebSocket endpoint.
 * Helius and other providers serve WS on a separate subdomain (wss://...).
 * Without an explicit wsEndpoint, @solana/web3.js derives the WS URL from
 * the HTTP URL, which works for localhost but NOT for Helius.
 *
 * This is required for `connection.onAccountChange()` subscriptions to
 * pump.fun bonding-curve PDAs — the sub-100ms real-time price feed.
 */
export function createWsConnection(
  rpcUrl: string,
  wsUrl: string,
  commitment: Commitment = "processed",
): Connection {
  return new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment });
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;
