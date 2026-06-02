import { Keypair, Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { SOL_MINT, LAMPORTS_PER_SOL } from "./rpc.js";
import { getPriorityFeeEstimate, type PriorityLevel } from "./priority-fee.js";

const JUPITER_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap/v1/swap";

interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number | string;
  slippageBps: number;
}

interface QuoteResponse {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
  slippageBps?: number;
}

interface SwapParams {
  connection: Connection;
  wallet: Keypair;
  inputMint: string;
  outputMint: string;
  amountLamports: number | string;
  slippageBps: number;
  /** Cap for priority-fee estimation. Defaults to 0.001 SOL (1_000_000 lamports). */
  maxPriorityFeeLamports?: number;
  /** Jupiter priority percentile. Defaults to "veryHigh" (75th pct). */
  priorityLevel?: "medium" | "high" | "veryHigh";
}

export interface SwapResult {
  txSignature: string;
  inputAmount: string;
  outputAmount: string;
  /**
   * Ground-truth SOL the wallet actually paid for this swap, measured as the
   * pre/post native-balance delta on the SOL side. For a BUY this is the SOL
   * leg spent (incl. base + priority fee + ATA rent + WSOL wrap); for a SELL
   * it is the SOL received (negative "spent"). Undefined if balance read fails.
   */
  solSpentLamports?: number;
  /** Priority fee Jupiter reported it applied, in lamports. */
  priorityFeeLamports?: number;
  /** Quote's expected output (before execution). */
  quotedOutAmount: string;
  /** Realized slippage in bps vs the quoted output (executed amount unknown → derived from threshold). */
  slippageBps: number;
  /** Jupiter quote price impact, fraction (e.g. 0.0123 = 1.23%). */
  priceImpactPct?: number;
}

async function jupiterQuote(p: QuoteParams): Promise<QuoteResponse> {
  const url = new URL(JUPITER_QUOTE);
  url.searchParams.set("inputMint", p.inputMint);
  url.searchParams.set("outputMint", p.outputMint);
  url.searchParams.set("amount", String(p.amount));
  url.searchParams.set("slippageBps", String(p.slippageBps));
  url.searchParams.set("dynamicSlippage", "true");
  url.searchParams.set("restrictIntermediateTokens", "true");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
  return (await res.json()) as QuoteResponse;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  prioritizationFeeLamports?: number;
  dynamicSlippageReport?: { slippageBps?: number };
}

async function jupiterSwap(
  quoteResponse: unknown,
  userPubkey: string,
  maxPriorityFeeLamports: number,
  priorityLevel: "medium" | "high" | "veryHigh",
): Promise<JupiterSwapResponse> {
  const res = await fetch(JUPITER_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: userPubkey,
      // Simulate to get an accurate CU limit → lower priority fee, better landing.
      dynamicComputeUnitLimit: true,
      // Let Jupiter pick slippage from the dynamicSlippage quote.
      dynamicSlippage: true,
      // Control the priority fee with a hard cap instead of accepting an
      // uncontrolled default — this is the primary fee-bleed fix.
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel,
          maxLamports: maxPriorityFeeLamports,
          global: false,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap failed: ${res.status}`);
  return (await res.json()) as JupiterSwapResponse;
}

async function nativeBalanceLamports(connection: Connection, owner: PublicKey): Promise<number | undefined> {
  try {
    return await connection.getBalance(owner, "confirmed");
  } catch {
    return undefined;
  }
}

export async function swapBuy(p: SwapParams): Promise<SwapResult> {
  const maxPriorityFeeLamports = p.maxPriorityFeeLamports ?? 100_000;
  const priorityLevel = p.priorityLevel ?? "high";

  const quote = await jupiterQuote({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amountLamports,
    slippageBps: p.slippageBps,
  });

  const owner = p.wallet.publicKey;
  const balBefore = await nativeBalanceLamports(p.connection, owner);

  const swapResp = await jupiterSwap(
    quote,
    owner.toBase58(),
    maxPriorityFeeLamports,
    priorityLevel,
  );
  const tx = VersionedTransaction.deserialize(Buffer.from(swapResp.swapTransaction, "base64"));
  tx.sign([p.wallet]);

  const txSig = await p.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });
  await p.connection.confirmTransaction(txSig, "confirmed");

  const balAfter = await nativeBalanceLamports(p.connection, owner);
  // For a BUY (input = SOL) the native balance drops by spent SOL + fees.
  // For a SELL (output = SOL) it rises, so solSpentLamports is negative.
  let solSpentLamports: number | undefined;
  if (balBefore !== undefined && balAfter !== undefined) {
    solSpentLamports = balBefore - balAfter;
  }

  // Realized slippage proxy: how far the guaranteed-minimum (otherAmountThreshold)
  // sits below the quoted outAmount, in bps. This is the worst-case slippage the
  // route accepted; combined with dynamicSlippageReport it bounds execution cost.
  const out = Number(quote.outAmount);
  const minOut = Number(quote.otherAmountThreshold ?? quote.outAmount);
  const thresholdSlipBps = out > 0 ? Math.max(0, ((out - minOut) / out) * 10_000) : 0;
  const reportedSlipBps = swapResp.dynamicSlippageReport?.slippageBps;
  const slippageBps = reportedSlipBps ?? Math.round(thresholdSlipBps);

  return {
    txSignature: txSig,
    inputAmount: quote.inAmount,
    outputAmount: quote.outAmount,
    solSpentLamports,
    priorityFeeLamports: swapResp.prioritizationFeeLamports,
    quotedOutAmount: quote.outAmount,
    slippageBps,
    priceImpactPct: quote.priceImpactPct ? Number(quote.priceImpactPct) : undefined,
  };
}

export async function swapSell(
  connection: Connection,
  wallet: Keypair,
  tokenMint: string,
  rawTokenAmount: string,
  slippageBps: number,
  opts?: { maxPriorityFeeLamports?: number; priorityLevel?: "medium" | "high" | "veryHigh" },
): Promise<SwapResult> {
  return swapBuy({
    connection,
    wallet,
    inputMint: tokenMint,
    outputMint: SOL_MINT,
    amountLamports: Number(rawTokenAmount),
    slippageBps,
    maxPriorityFeeLamports: opts?.maxPriorityFeeLamports,
    priorityLevel: opts?.priorityLevel,
  });
}

export { LAMPORTS_PER_SOL, getPriorityFeeEstimate, type PriorityLevel };
