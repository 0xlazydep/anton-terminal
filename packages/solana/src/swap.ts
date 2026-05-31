import { Keypair, Connection } from "@solana/web3.js";
import { decodeInstruction, buildV0Transaction, signTx } from "./tx.js";
import { SOL_MINT } from "./rpc.js";

const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";

interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
}

interface SwapParams {
  connection: Connection;
  wallet: Keypair;
  inputMint: string;
  outputMint: string;
  amountLamports: number;
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

async function jupiterSwap(quoteResponse: unknown) {
  const res = await fetch(JUPITER_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: "",
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { autoMultiplier: 2 },
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap failed: ${res.status}`);
  return res.json() as Promise<{ setupInstructions: any[]; swapInstruction: any }>;
}

export async function swapBuy(p: SwapParams): Promise<SwapResult> {
  const quote = await jupiterQuote({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amountLamports,
    slippageBps: p.slippageBps,
  });

  const swapBody = await jupiterSwap(quote);
  const allIx = [...(swapBody.setupInstructions ?? []), swapBody.swapInstruction].map(decodeInstruction);

  const tx = await buildV0Transaction({
    connection: p.connection,
    payer: p.wallet.publicKey,
    instructions: allIx,
    computeUnitLimit: 1_400_000,
    computeUnitPriceMicroLamports: 5000,
  });

  signTx(tx, p.wallet);

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
  amountLamports: number,
  slippageBps: number,
): Promise<SwapResult> {
  return swapBuy({ connection, wallet, inputMint: tokenMint, outputMint: SOL_MINT, amountLamports, slippageBps });
}
