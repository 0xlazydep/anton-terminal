# 07 — Execution Engine (Swaps, MEV, Dry-Run)

Fast scalp execution on Solana. Jupiter for routing, Jito for MEV protection, dynamic priority fees, careful slippage. Dry-run and live share one code path.

---

## 1. Execution Flow

```
Decision (BUY/SELL, size, slippage)
  │
  ▼ 1. Jupiter Swap V2 /build  → raw instructions (NO platform fee)
  ▼ 2. Assemble v0 tx (compute budget FIRST) + ALTs
  ▼ 3. Add Jito `dontfront` key (sandwich protection)
  ▼ 4. Priority fee = Helius getPriorityFeeEstimate (High/75th)
  ▼ 5. Simulate → set CU limit (actual × 1.1)
  ▼ 6. Sign (hot wallet)
  ▼ 7a. DRY-RUN  → stop here, record simulated fill
  ▼ 7b. LIVE     → Jito sendTransaction (bundleOnly) OR own RPC
  ▼ 8. Confirm (gRPC/poll) → record fill, open position
```

**Dry-run parity:** identical through step 6 (build, simulate, fee calc). Only step 7 differs. Simulated fills use the Jupiter quote `outAmount` + simulated price impact → realistic PnL without spending.

---

## 2. Jupiter Swap V2 — `/build` (Zero Fee, Full Control)

**Base:** `https://api.jup.ag/swap/v2` · `x-api-key`.

> Use `/build` (Router) NOT `/order`+`/execute` (Meta-Aggregator). `/build` = no Jupiter platform fee + full tx control — essential for thin scalp margins.

```typescript
// packages/execution/src/jupiter.ts
const BASE = 'https://api.jup.ag/swap/v2';
const H = { 'x-api-key': process.env.JUPITER_API_KEY! };

async function buildSwap(p: {
  inputMint: string; outputMint: string; amount: string; taker: string; slippageBps: number;
}) {
  const qs = new URLSearchParams({
    inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: p.taker,
    slippageBps: String(p.slippageBps),
    computeUnitPricePercentile: 'veryHigh', maxAccounts: '64',
  });
  const res = await fetch(`${BASE}/build?${qs}`, { headers: H });
  return res.json(); // computeBudgetInstructions, setupInstructions, swapInstruction,
                     // cleanupInstruction, addressesByLookupTableAddress, blockhashWithMetadata
}
```

**Price-only checks** (no swap): call `/order` WITHOUT `taker` → quote with `outAmount`. Or Jupiter Price v3 batched.

**SOL mint:** `So11111111111111111111111111111111111111112`. 0.1 SOL = `100000000` lamports (amount in smallest unit).

---

## 3. Transaction Assembly (v0 + ALTs + dontfront)

```typescript
// packages/solana/src/tx.ts
import {
  Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram, TransactionInstruction,
} from '@solana/web3.js';

const DONT_FRONT = new PublicKey('jitodontfront111111111111111111111111111111');
const withDontFront = (ix: TransactionInstruction) => new TransactionInstruction({
  ...ix, keys: [...ix.keys, { pubkey: DONT_FRONT, isSigner: false, isWritable: false }],
});

export async function assemble(conn: Connection, payer: Keypair, build: any, cuPrice: number) {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }), // refined by sim
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
    ...decode(build.setupInstructions),
    withDontFront(decode1(build.swapInstruction)),
    ...(build.cleanupInstruction ? [decode1(build.cleanupInstruction)] : []),
  ];
  const alts = await loadAlts(conn, build.addressesByLookupTableAddress);
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs })
    .compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  // simulate for real CU before signing:
  const sim = await conn.simulateTransaction(tx, { sigVerify: false });
  // ...rebuild with setComputeUnitLimit = ceil(sim.unitsConsumed * 1.1)...
  tx.sign([payer]);
  return tx;
}
```

ALTs required (Jupiter swaps touch 15–25 accounts). Compute-budget ix MUST be first.

---

## 4. Priority Fees (Helius, Dynamic)

```typescript
// packages/execution/src/priority-fee.ts
// POST https://mainnet.helius-rpc.com/?api-key=KEY
// method: getPriorityFeeEstimate
// params: [{ accountKeys: [poolPubkey], options: { priorityLevel: 'High' } }]  → microLamports
```

Use **High (75th percentile)** for scalps; **VeryHigh (95th)** for emergency exits. Self-tune: if land-rate <80% raise fee ×1.1; if >95% lower ×0.95.

---

## 5. MEV Protection & Landing (Jito)

```typescript
// packages/execution/src/jito.ts
// Single-tx, sandwich-protected, revert-protected:
// POST https://mainnet.block-engine.jito.wtf/api/v1/transactions?bundleOnly=true
//   method: sendTransaction, params: [base64Tx, { encoding: 'base64' }]
```

- `dontfront` key → forces index 0 in any bundle (no front-run).
- `bundleOnly=true` → revert protection (no tip paid on fail).
- Tip: 1,000+ lamports to a random Jito tip account (last instruction) when using bundles.
- Even 0.1 SOL trades get sandwiched on thin pools — use Jito on every live trade.

**Landing stack:** staked Helius RPC (SWQoS) + dynamic priority fee + Jito. Expect >95% land within 2 slots.

---

## 6. Slippage Strategy (Meme-Specific)

| Phase | Buy slippage | Sell slippage |
|---|---|---|
| Just graduated (<5m) | 15–30% | 10–20% |
| Established meme (30m+) | 3–8% | 3–5% |
| Under dump | — | 10–20% (get out) |
| Liquidity <$5k | REJECT | emergency 25% |

Principle: slippage is a **risk boundary**, not a "make it work" knob. If 10% fails, re-evaluate the trade — don't ratchet to 20%. Tight slippage also deters sandwiches.

---

## 7. Dry-Run vs Live

```typescript
// packages/execution/src/engine.ts
export async function execute(decision: Decision, mode: 'dry-run'|'live') {
  const build = await buildSwap(toSwapParams(decision));
  const tx = await assemble(conn, wallet, build, await priorityFee(decision.poolPubkey));

  if (mode === 'dry-run') {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false });
    return recordSimulatedFill(decision, build, sim);   // realistic fill, no spend
  }
  const sig = await jitoSend(tx);                        // live
  const fill = await confirmAndPrice(conn, sig);
  return openPosition(decision, fill);                  // persists + opens position
}
```

Mode is global config (operator toggles in dashboard) and can be overridden per-decision. Live requires explicit operator opt-in + passes all hard caps (see `10-CONFIG-DEPLOY.md`).

---

## 8. Position Monitoring (SL/TP + Mirror Exit)

A `monitor` worker per open position:
- Polls/streams price (Jupiter Price v3 / Birdeye / gRPC).
- Triggers SELL decision when `pnlPct <= stopLossPct` or `>= takeProfitPct`.
- Watches tracked smart wallets of that token — if trust-weighted wallets exit, enqueue SELL (agent confirms with reason).
- Trailing stop optional (config). Emits `position_update` to dashboard.

---

## 9. Wallet & Keys

- **Hot wallet:** `Keypair.fromSecretKey(bs58.decode(env.SOLANA_PRIVATE_KEY))`. Holds only ~1h of trading SOL.
- **Cold funding wallet:** separate, refills hot wallet via a separate script; never loaded into the agent process.
- Keys from env/secrets manager. Never logged, never streamed to UI.

**npm:** `@solana/web3.js` ^1.95, `bs58`, Jito via `jito-js-rpc`. (web3.js v2/`@solana/kit` deferred — ecosystem still on v1.)
