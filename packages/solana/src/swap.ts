import { Keypair, Connection, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT, LAMPORTS_PER_SOL } from "./rpc.js";

const JUPITER_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap/v1/swap";

interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number | string;
  slippageBps: number;
}

interface SwapParams {
  connection: Connection;
  wallet: Keypair;
  inputMint: string;
  outputMint: string;
  amountLamports: number | string;
  slippageBps: number;
}

export interface SwapResult {
  txSignature: string;
  inputAmount: string;
  outputAmount: string;
}

async function jupiterQuote(p: QuoteParams) {
  const url = new URL(JUPITER_QUOTE);
  url.searchParams.set("inputMint", p.inputMint);
  url.searchParams.set("outputMint", p.outputMint);
  url.searchParams.set("amount", String(p.amount));
  url.searchParams.set("slippageBps", String(p.slippageBps));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
  return res.json() as Promise<{ inAmount: string; outAmount: string }>;
}

async function jupiterSwap(quoteResponse: unknown, userPubkey: string) {
  const res = await fetch(JUPITER_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey: userPubkey }),
  });
  if (!res.ok) throw new Error(`Jupiter swap failed: ${res.status}`);
  return res.json() as Promise<{ swapTransaction: string }>;
}

export async function swapBuy(p: SwapParams): Promise<SwapResult> {
  const quote = await jupiterQuote({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amountLamports,
    slippageBps: p.slippageBps,
  });

  const { swapTransaction } = await jupiterSwap(quote, p.wallet.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([p.wallet]);

  const txSig = await p.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });
  await p.connection.confirmTransaction(txSig, "confirmed");

  return { txSignature: txSig, inputAmount: quote.inAmount, outputAmount: quote.outAmount };
}

export async function swapSell(
  connection: Connection,
  wallet: Keypair,
  tokenMint: string,
  rawTokenAmount: string,
  slippageBps: number,
): Promise<SwapResult> {
  return swapBuy({
    connection,
    wallet,
    inputMint: tokenMint,
    outputMint: SOL_MINT,
    amountLamports: Number(rawTokenAmount),
    slippageBps,
  });
}
