# 06 — Safety Screening (Rug / Honeypot)

Every candidate passes a layered pipeline before Anton risks capital. Fail fast, fail cheap: on-chain RPC checks first (free, ~1s), expensive API checks only for survivors.

---

## 1. Pipeline (Fail-Fast Layers)

```
Candidate
  │
  ▼ Layer 1: On-chain RPC (~1s, free)         ── mint/freeze authority, top-10 concentration
  │   FAIL → REJECT (cheap)
  ▼ Layer 2: DexScreener (~200ms, free)        ── liquidity USD, pair age, volume
  │   FAIL → REJECT
  ▼ Layer 3: RugCheck (~500ms)                 ── risk score, LP lock %, insider networks, mutable meta
  │   score>60 → REJECT ; 30–60 → need extra confidence
  ▼ Layer 4: Deep (high-conviction only)       ── Birdeye holder tags, Bubblemaps clusters,
  │                                                GoPlus sim, Jupiter buy/sell honeypot test
  ▼ ScreeningReport → Agent
```

```typescript
interface ScreeningReport {
  mint: string;
  verdict: 'SAFE' | 'CAUTION' | 'REJECT';
  score: number;                 // 0-100, lower safer
  checks: Record<string, { pass: boolean; value?: unknown; note?: string }>;
  liquidityUsd?: number;
  pairAgeSec?: number;
  lpLockedPct?: number;
  top10Pct?: number;
  flags: string[];               // e.g. ['mint_authority_active','honeypot']
  ts: number;
}
```

---

## 2. Layer 1 — On-Chain RPC (Deterministic, Free)

```typescript
// packages/screening/src/onchain.ts
import { Connection, PublicKey } from '@solana/web3.js';

export async function onchainChecks(conn: Connection, mint: PublicKey) {
  const info: any = await conn.getParsedAccountInfo(mint);
  const p = info.value?.data?.parsed?.info;
  const mintAuthority   = p?.mintAuthority ?? null;     // MUST be null for memes
  const freezeAuthority = p?.freezeAuthority ?? null;   // MUST be null for memes
  const supply = Number(p?.supply); const decimals = p?.decimals;

  const largest = await conn.getTokenLargestAccounts(mint);
  const top10 = largest.value.slice(0,10)
    .reduce((s,a)=> s + Number(a.uiAmount ?? 0), 0);
  const top10Pct = top10 / (supply / 10**decimals) * 100;  // exclude known LP/CEX in prod

  return {
    mintAuthorityRevoked:   mintAuthority === null,
    freezeAuthorityRevoked: freezeAuthority === null,
    top10Pct,
    isToken2022: info.value?.owner?.toString().includes('Token2022'),
  };
}
```

**Reject immediately if** (memecoin presets): mint authority active (-30), freeze authority active (-20), or `top10Pct > 50` (severe).

**Token-2022 extra risks** to detect: `TransferFee` (creator skims), `PermanentDelegate`, `TransferHook` (can block sells), `NonTransferable` (obvious honeypot).

---

## 3. Layer 2 — DexScreener (Liquidity / Age / Volume)

```typescript
// GET https://api.dexscreener.com/latest/dex/tokens/{mint}
// pick highest-liquidity pair → liquidity.usd, pairCreatedAt, volume.h24
```

**Reject if:** `liquidity.usd < minLiquidityUsd` (preset) OR `age < minTokenAgeSec` (e.g. new launch <60s for non-snipe mode) OR no active pair.

---

## 4. Layer 3 — RugCheck (Risk Score + LP)

```typescript
// GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary
// → score_normalised (0-100, higher=riskier), risks[], lpLockedPct
// Full report adds: tokenMeta.mutable, topHolders[], insiderNetworks, creatorBalance
```

**Rules:** `score_normalised > 60` → REJECT. `lpLockedPct` low/zero → REJECT (rug risk). `tokenMeta.mutable === true` → flag (bait-and-switch). `30–60` → pass only with extra confidence (smart-wallet backing or strong social).

---

## 5. Layer 4 — Deep Checks (High-Conviction Only)

Run only for candidates Anton is seriously considering (cost control).

| Check | Provider | Signal |
|---|---|---|
| Holder tags | Birdeye `/v1/token/holder-profile` | bundler/sniper/insider/dev % + PnL |
| Wallet clusters | Bubblemaps `/v0/tokens/map` | connected clusters, decentralization score |
| Token security | GoPlus `/api/v1/token_security/solana` | authorities, transfer hooks, sim |
| Honeypot | Jupiter quotes | buy quote + sell quote both viable? |

**Honeypot test (critical):**
```typescript
// 1. Jupiter /order buy (SOL→TOKEN) small amount → expect outAmount
// 2. Jupiter /order sell (TOKEN→SOL) same amount → must return a viable route
// No sell route OR extreme one-way slippage OR nonTransferable → HONEYPOT → REJECT
```

---

## 6. Composite Scoring (Presets)

```typescript
// packages/screening/src/score.ts  — lower score = safer
const PRESETS = {
  strict:  { minLpSol: 50, lpLocked: 0.8, top10Max: 30, singleMax: 10, mintFreezeRevoked: true },
  normal:  { minLpSol: 20, lpLocked: null, top10Max: 50, singleMax: 20, mintFreezeRevoked: true },
  relaxed: { minLpSol: 5,  lpLocked: null, top10Max: 70, singleMax: 30, mintFreezeRevoked: true },
};
```

`mintFreezeRevoked` is non-negotiable for memes in all presets. Snipe mode (very new launches) uses `relaxed` liquidity but still requires authorities revoked and a viable sell route.

**Verdict mapping:** score < 30 → SAFE; 30–60 → CAUTION (needs smart-wallet/social backing); > 60 → REJECT.

---

## 7. Output → Agent & Dashboard

- `get_screening_report(mint)` returns the `ScreeningReport` to DeepSeek.
- Each layer emits a `screening_layer_*` event + final `screening_result` to the dashboard (live screening panel) so the operator sees exactly why a token passed/failed.
- Reports cached briefly (Redis, ~2 min) to avoid re-screening the same mint across cycles.

**Libraries to lean on:** RugCheck wrapper, `dexscreener-ts`, `solana-token-guard` (config presets), GoPlus MCP/SDK.
