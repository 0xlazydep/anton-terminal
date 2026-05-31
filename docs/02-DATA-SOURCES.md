# 02 — Data Sources & Token Ingestion

How Anton discovers tradeable tokens. Four parallel sources feed a unified **candidate stream** that flows into screening.

---

## 1. Source Overview

| Source | Provider | Transport | Signal | Cost |
|---|---|---|---|---|
| New launches | PumpPortal | WebSocket | Brand-new Pump.fun mints | Free |
| Graduations | PumpPortal | WebSocket | Tokens migrating to PumpSwap/Raydium | Free |
| Trending (on-chain) | Jupiter Tokens v2 | REST poll | `toptrending`, `recent`, top-traded | $25/mo tier |
| Trending (market) | DexScreener + Birdeye | REST poll + WS | Boosts, volume spikes, meme list | Free / $99 |
| Social trending | Apify + LunarCrush + Birdeye | REST poll | Twitter cashtag velocity, mindshare | ~$5–40/mo |

All sources normalize to a `TokenCandidate`:

```typescript
interface TokenCandidate {
  mint: string;                 // Solana mint address (primary key)
  symbol?: string;
  name?: string;
  source: 'pumpfun_new' | 'pumpfun_migration' | 'jupiter_trending'
        | 'dexscreener_trending' | 'social_trending' | 'smart_wallet';
  detectedAt: number;           // unix ms
  phase: 'bonding_curve' | 'graduated' | 'unknown';
  raw: Record<string, unknown>; // original payload for audit
  signals: {
    liquidityUsd?: number;
    volume5mUsd?: number;
    priceUsd?: number;
    socialMentions?: number;
    smartWallets?: string[];    // smart wallets currently in this token
  };
}
```

Candidates are **deduplicated by mint** (Redis set with TTL) and pushed onto the `anton:candidates` queue.

---

## 2. Pump.fun — New Launches & Graduations (PumpPortal WebSocket)

**Endpoint:** `wss://pumpportal.fun/api/data?api-key=KEY`

**Rules (critical):** ONE websocket connection for ALL subscriptions. Multiple connections → temp ban (hourly expiry). Max 200 sub messages/sec, 5000 addresses/message.

```typescript
// packages/ingestion/src/pumpfun-listener.ts
import WebSocket from 'ws';

const ws = new WebSocket('wss://pumpportal.fun/api/data?api-key=' + KEY);

ws.on('open', () => {
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));      // free
  ws.send(JSON.stringify({ method: 'subscribeMigration' }));      // free
});

ws.on('message', (raw) => {
  const d = JSON.parse(raw.toString());
  // txType: "create" | "buy" | "sell" ; fields: mint, name, symbol,
  // solAmount, tokenAmount, bondingCurveKey, user, signature
  if (d.txType === 'create') {
    emitCandidate({
      mint: d.mint, symbol: d.symbol, name: d.name,
      source: 'pumpfun_new', phase: 'bonding_curve',
      detectedAt: Date.now(), raw: d, signals: {},
    });
  }
});
```

**Subscriptions available:**

| Method | Cost | Use |
|---|---|---|
| `subscribeNewToken` | Free | New mint creation |
| `subscribeMigration` | Free | Graduation → PumpSwap |
| `subscribeTokenTrade` (keys[]) | 0.01 SOL/10k events | Watch trades on held tokens |
| `subscribeAccountTrade` (keys[]) | 0.01 SOL/10k events | Watch smart-wallet trades (see learning) |

**Bonding curve facts (for pricing/graduation):**
- Curve holds 793.1M tokens; virtual reserves: 30 SOL / 1.073B tokens; `k = vSol * vTokens`.
- Spot price = `vSol / vTokens`. Graduates when `realTokenReserves == 0` (~85 real SOL, ~$69k mcap).
- On-chain Pump program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; PumpSwap AMM: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`.

---

## 3. Jupiter — Trending & Recent (Tokens API v2)

**Base:** `https://api.jup.ag/tokens/v2` · Auth: `x-api-key` header.

```typescript
// packages/ingestion/src/jupiter-trending.ts
const H = { 'x-api-key': process.env.JUPITER_API_KEY! };
const BASE = 'https://api.jup.ag/tokens/v2';

// Poll every 30–60s
const trending = await fetch(`${BASE}/toptrending/5m?limit=50`, { headers: H });
const recent   = await fetch(`${BASE}/recent`, { headers: H }); // newest first-pool
```

**Endpoints:**
- `/toptrending/{5m|1h|6h|24h}?limit=` — trending by activity
- `/recent` — tokens with newest first pool
- `/search?query=` — resolve symbol/name → mint
- `/tag?query=verified` — verified list (cache for hours)

**TokenInfo filter fields** (use to pre-filter before screening): `organicScore`, `organicScoreLabel`, `audit.isSus`, `audit.mintAuthorityDisabled`, `audit.freezeAuthorityDisabled`, `audit.topHoldersPercentage`, `liquidity`, `holderCount`, `stats5m.{buyVolume,numBuys,numTraders}`, `isVerified`.

**Pre-filter rule:** drop if `audit.isSus === true` OR `organicScoreLabel === 'low'` OR `mintAuthorityDisabled === false` OR `freezeAuthorityDisabled === false` OR `liquidity < $5k`.

---

## 4. DexScreener & Birdeye — Market Trending

**DexScreener** (free, no key; 60–300 req/min):
- `GET /token-boosts/top/v1` — trending (boosts)
- `GET /token-profiles/latest/v1` — new profiles + socials
- `GET /latest/dex/search?q=` — ticker → mint resolution
- WS: `wss://api.dexscreener.com/token-boosts/top/v1`

**Birdeye** (`X-API-KEY`, `x-chain: solana`):
- `GET /defi/token_trending?sort_by=rank&limit=20`
- `GET /defi/v3/token/meme/list` — meme universe
- `GET /defi/v3/search?keyword=&chain=solana&sort_by=fdv` — canonical mint resolution

---

## 5. Social Signal — Twitter Trending (Tiered, Cost-Optimized)

**Decision:** Do NOT use raw X API for broad monitoring (Feb 2026 pay-per-use, $0.005/read, 2M cap — too costly). Instead:

**Tier 1 — Discover (free/cheap):** DexScreener + Birdeye trending give the candidate set of what's already moving.

**Tier 2 — Validate social (selective):** For each Tier-1 candidate, measure Twitter mention velocity via **Apify cashtag scraper** (`fastcrawler/twitter-x-crypto-stock-sentiment-scraper`, ~$0.01/1k results) and **LunarCrush** Galaxy Score / mindshare.

**Tier 3 — Deep intel (on-demand):** Kaito mindshare delta + TweetScout KOL credibility for high-conviction candidates only.

```typescript
// packages/ingestion/src/social-signal.ts
interface SocialSignal {
  mint: string;
  mentions5m: number;
  velocityZScore: number;     // (rate - mean) / std over rolling window
  uniqueAuthors: number;
  influencerWeight: number;   // sum of author weights (follower tiers × TweetScout)
  galaxyScore?: number;       // LunarCrush
  sentiment?: number;
}
```

**Address/cashtag extraction:**
```typescript
const SOLANA_MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const CASHTAG = /\$([A-Z]{2,10})\b/g;
// Images: OCR (Tesseract/Vision) → re-run regex. Validate every hit vs DexScreener.
```

**Ticker → canonical mint resolution** (the ambiguity/scam problem):
1. Search DexScreener + Birdeye for the ticker.
2. Filter to Solana, `liquidity > $10k`.
3. Rank by composite: FDV (0.3) + volume24h (0.3) + liquidity (0.2) + holders (0.1) + verified (0.1).
4. Cross-check token's profile Twitter matches the tweeting account. Pick top score.

---

## 6. Candidate Pipeline (Wiring)

```
PumpPortal WS ─┐
Jupiter poll ──┤
DexScreener ───┼─▶ normalize → dedup (Redis TTL) → enrich(price,liq) ─▶ anton:candidates (BullMQ)
Birdeye poll ──┤                                                              │
Social signal ─┘                                                              ▼
Smart-wallet ──────────────────────────────────────────────────────▶  SCREENING (06)
```

- **Dedup:** `SETNX anton:seen:{mint}` with 6h TTL. Re-surfacing a known mint updates signals but doesn't re-enqueue unless a stronger signal (e.g., smart wallet entered) appears.
- **Backpressure:** candidate queue capped; lowest-signal candidates dropped first under load.
- **Enrichment:** every candidate gets a price (Jupiter Price v3 batched, 50 mints/call) + liquidity before screening.

---

## 7. Source Selection Summary

| Need | Primary | Fallback |
|---|---|---|
| New mints (realtime) | PumpPortal `subscribeNewToken` | Helius blockSubscribe on Pump program |
| Graduations | PumpPortal `subscribeMigration` | poll `bondingCurve.complete` |
| Trending tokens | Jupiter `toptrending/5m` | DexScreener boosts / Birdeye trending |
| Price | Jupiter Price v3 | Birdeye `/defi/price` |
| Ticker→mint | Birdeye `/defi/v3/search` | DexScreener `/latest/dex/search` |
| Social velocity | Apify cashtag scraper | LunarCrush topics |
| Axiom | (no official API — UI only; skip) | Mobula Pulse Stream V2 if needed |
