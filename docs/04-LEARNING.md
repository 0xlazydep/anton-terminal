# 04 — Smart-Wallet On-Chain Learning

Anton learns by watching profitable wallets. It tracks their swaps, reconstructs their entry/TP/SL behavior, and derives imitation signals that feed the agent's reasoning.

---

## 1. Three-Stage Pipeline

```
DISCOVER          →  TRACK (realtime)        →  LEARN / IMITATE
smart-money lists     stream their swaps        reconstruct TP/SL,
(GMGN, Birdeye,        (Helius webhooks,         compute win-rate,
 Nansen, Cielo)        Cielo WS, gRPC)          derive signals
```

---

## 2. Stage 1 — Discover Smart-Money Wallets

Build a curated **wallet universe** (the wallets Anton imitates).

| Source | Method | Returns |
|---|---|---|
| GMGN (free) | `gmgn-cli track smartmoney --chain sol` | smart_degen, kol, fresh, sniper categories |
| GMGN | `portfolio stats --wallet --period 30d` | `realized_profit`, `winrate`, `pnl` |
| Birdeye | `GET /defi/v2/tokens/top_traders?sort_by=realized_pnl` | per-token top traders |
| Nansen (premium) | `smart-money/dex-trades`, labels | curated top-5k wallets, Solana labels |
| Cielo | web app → tracked list → `list_id` | streamable curated list |

**Curation filter (allowlist):** keep wallets with `winrate > 55%`, `realized_profit_30d > threshold`, `trade_count >= 20`, not flagged as bot-only. Store in `smart_wallets` table with rolling performance.

```typescript
interface SmartWallet {
  address: string;
  label: string;                // 'smart_degen' | 'kol' | 'nansen_smart' ...
  winRate: number;              // 0-1, rolling 30d
  realizedPnl30dUsd: number;
  avgHoldSeconds: number;
  tradeCount30d: number;
  trust: number;                // 0-1 composite Anton-assigned weight
  active: boolean;
  lastEvaluated: number;
}
```

Re-evaluate the universe daily (BullMQ job) — demote/retire wallets whose win-rate decays.

---

## 3. Stage 2 — Track Their Swaps in Realtime

**Primary: Helius Enhanced Webhooks** (parsed SWAP events).

```typescript
// packages/learning/src/helius-webhook.ts
// POST https://api-mainnet.helius-rpc.com/v0/webhooks  (Bearer KEY)
// body: { accountAddresses: [...universe], transactionTypes: ['SWAP','BUY','SELL'],
//         webhookURL, webhookType: 'enhanced' }

// Inbound webhook handler:
function onSwap(ev: HeliusEnhancedTx) {
  const s = ev.events?.swap; if (!s) return;
  const side = s.nativeInput ? 'BUY' : 'SELL';        // SOL in = buy token
  recordWalletSwap({
    wallet: ev.feePayer, signature: ev.signature, ts: ev.timestamp,
    side,
    tokenMint: side === 'BUY' ? s.tokenOutput.mint : s.tokenInput.mint,
    solAmount: Number(side === 'BUY' ? s.nativeInput.amount : s.nativeOutput.amount),
    tokenAmount: Number(side === 'BUY' ? s.tokenOutput.amount : s.tokenInput.amount),
  });
}
```

**Secondary (lightweight): Cielo WebSocket** — `wss://feed-api.cielo.finance/api/v1/ws`, `subscribe_feed` with `list_id` for the whole curated list; rich fields incl. `first_interaction`.

**Scale (low-latency): Helius LaserStream / Shyft gRPC** (Yellowstone) with `accountInclude: [...universe]`. Shyft allows up to 150k addresses/filter, unmetered. Use when webhook latency isn't enough for hot scalps.

Every swap → `wallet_swaps` table + pushed to `anton:smart-wallet` event stream. A BUY by a high-trust wallet on a screened token can trigger Anton's fast-path decision.

---

## 4. Stage 3 — Reconstruct TP/SL Behavior & Learn

For each smart wallet, reconstruct **positions** from their swap stream to infer HOW they take profit and cut losses.

```typescript
interface WalletPosition {
  wallet: string; tokenMint: string;
  entryTs: number; entrySolCost: number; entryPriceUsd: number;
  exits: { ts: number; fraction: number; priceUsd: number }[]; // partial exits
  closedTs?: number;
  realizedPnlPct?: number;
  holdSeconds?: number;
  // Inferred behavior:
  tpStyle?: 'single' | 'scaled' | 'moonbag';   // exit pattern
  slHitPct?: number;                            // largest adverse move before exit
  maxGainPct?: number;
}
```

**Reconstruction logic:** match BUYs and SELLs per (wallet, mint) FIFO; price each leg via OHLCV at that timestamp (TimescaleDB) or Birdeye historical. From closed positions, derive aggregate behavioral stats per wallet:

- **Typical TP:** median `realizedPnlPct` on wins, and whether they scale out (multiple partial exits) vs single dump.
- **Typical SL:** median adverse % before a losing exit (how much pain they tolerate).
- **Hold time:** median `holdSeconds` (informs Anton's scalp horizon).
- **Win-rate & expectancy** per wallet (cross-check vs GMGN/Birdeye PnL APIs).

These become **imitation parameters** Anton's reasoning can use:

```typescript
interface ImitationProfile {
  wallet: string; trust: number;
  medianTpPct: number;        // e.g. +60%
  medianSlPct: number;        // e.g. -22%
  scaleOut: boolean;          // takes partial profits
  medianHoldSec: number;
  recentWinRate: number;
}
```

---

## 5. Imitation Signal → Agent

When a screened candidate has smart-wallet activity, the `get_smart_wallet_context(mint)` tool returns:

```typescript
interface SmartWalletContext {
  mint: string;
  walletsIn: { wallet: string; trust: number; enteredAt: number; entryPriceUsd: number }[];
  walletsExiting: { wallet: string; soldFraction: number; ts: number }[];
  aggregate: {
    netTrustWeightedFlow: number;    // (trust-weighted buys) - (sells)
    avgEntryPriceUsd: number;
    suggestedTpPct: number;          // trust-weighted median of profiles
    suggestedSlPct: number;
    consensusHoldSec: number;
  };
}
```

The agent uses this as a STRONG prior but still verifies with screening + market data. Anton's `reason` field cites the smart-wallet basis (e.g. "3 smart wallets (trust 0.8 avg) entered within 90s; their median TP is +55%, SL −20% — mirroring with 0.1 SOL").

**Exit mirroring:** the monitor watches tracked wallets of an OPEN Anton position. If trust-weighted wallets begin exiting, the monitor enqueues a SELL decision (agent confirms with reason).

---

## 6. PnL Computation Sources (cross-check)

| Provider | Method | Notes |
|---|---|---|
| Birdeye | `/wallet/v2/pnl/summary`, `/details`, `/multiple` | pre-computed realized/unrealized |
| Bitquery | GraphQL `DEXTradeByTokens` aggregation | query-time PnL, flexible |
| GMGN | `portfolio stats/holdings` | winrate + per-token |
| Cielo | `/{wallet}/pnl/tokens`, `/trading-stats` | per-token + win-rate |
| Self | reconstruct from `wallet_swaps` + OHLCV | ground truth, no vendor cap |

Anton self-computes for the curated universe (ground truth) and uses vendor APIs for discovery/validation.

---

## 7. Anti-Patterns / Guards

- **Don't blindly copy:** smart wallets get rugged too. Screening (06) still gates every entry.
- **Latency realism:** Anton enters AFTER the smart wallet, at a worse price. Factor a slippage/entry-lag penalty into expected edge.
- **Wash/bot filtering:** exclude wallets whose "wins" are self-trading or MEV sandwiching (detect via repetitive same-block in/out).
- **Decay:** retire wallets whose recent win-rate drops; weight recent performance higher.
