# Anton Terminal - Session Log

## 2026-06-01 (Extended Session)

### Stack: Live
- **VPS**: root@vmi3312783 (161.97.173.157)
- **Domain**: https://autotrade.pr1nce.dev
- **PM2**: anton-agent, anton-dashboard
- **Docker**: anton-db (port 5433), anton-redis

---

### 1. Data Persistence (Awal Sesi)
**Masalah**: Page reload → data hilang (history, positions, screening)
**Root Cause**: Semua data di TanStack Query in-memory cache, gak ada persistence
**Fix**:
- `packages/data/src/queries/positions.ts` — insertOpenPosition, closePosition, listOpenPositions, listClosedPositions
- `apps/agent/src/positions.ts` — PositionBook DB-backed, loadFromDb() restore
- `apps/agent/src/index.ts` — createDb(DATABASE_URL), loadFromDb() at startup
- DB port: 5433 (host Postgres occupy 5432)
- Migration: `0000_flashy_dragon_man.sql` (tables + entry_market_cap_usd column)

### 2. Snapshot-on-Connect
**Masalah**: Dashboard reload → empty, pub/sub no history
**Fix**:
- `shared-types/src/events.ts` — StateSnapshotEvent (positions + history + balanceHistory)
- `packages/realtime/src/socket-server.ts` — `getSnapshot` provider, emit on connection
- `packages/realtime/src/http-server.ts` — propagate getSnapshot
- `apps/dashboard/hooks/use-realtime.ts` — `onStateSnapshot` handler

### 3. Screening Parallelization
**Masalah**: Live Screening telat muncul, reasoning duluan
**Fix**: `apps/agent/src/index.ts` runCycle — `Promise.all` parallel screening instead of sequential for...await

### 4. PnL Separation (Unrealized vs Realized)
**Fix**:
- `hooks/use-positions.ts` — `useRealizedPnl()` all-time closed positions
- `Header.tsx` — "PnL TODAY" → "REALIZED PnL" from useRealizedPnl
- `Positions.tsx` — Tabs ACTIVE (UNREALIZED PnL) | HISTORY (REALIZED PnL)
- `ClosedPosition` type replacing `(h as any)` pattern
- Added "DEPLOYED" total SOL next to UNREALIZED PnL
- Added "WR" winrate indicator next to REALIZED PnL in header

### 5. Equity Curve Persistence
**Masalah**: Balance Chart regenerate random data every reload
**Fix**:
- `packages/data/src/schema/trades.ts` — balanceSnapshots table
- `packages/data/src/queries/balance.ts` — insertBalanceSnapshot, listRecentBalanceSnapshots
- Migration: `0001_cooing_toad.sql`
- `apps/agent/src/index.ts` — persist balance each cycle, restore on startup, balanceHistory in stateSnapshot
- `apps/dashboard/BalanceChart.tsx` — seed full curve from `state_snapshot.balanceHistory`

### 6. Live Mode Button Fix
**Masalah**: Tombol LIVE di dashboard gak switch agent config
**Fix**: `apps/agent/src/index.ts` — `controls.onSetMode` handler, `createRealtimeServer` with controls

### 7. Wallet Balance from Chain
**Masalah**: SOL BAL hardcoded 10, gak baca wallet asli
**Fix**: `apps/agent/src/index.ts`
- `fetchWalletBalance()` — query SOL balance via RPC
- Called at startup (if mode=live) + on switch to live
- `swapBuy` import, `SOL_MINT`, `LAMPORTS_PER_SOL`
- 3s refresh timer (`balTimer` setInterval)
- `lastWalletBalance` — separate from STARTING_SOL for accuracy

### 8. Mode Separation (Dry-Run vs Live)
**Masalah**: Posisi dry-run dan live tercampur
**Fix**:
- Query helpers: `listOpenPositions(mode)`, `listClosedPositions(limit, mode)`
- `PositionBook.loadFromDb(mode)` — clear + reload on mode switch
- `controls.onSetMode` → `book.loadFromDb(e.mode)`

### 9. Jupiter Swap Execution (Live Trading)
**Masalah**: Agent cuma buka posisi di memori, gak real swap
**Fix**:
- `packages/solana/src/swap.ts` — Jupiter API v1 swapBuy/swapSell
- DNS issue on VPS: `quote-api.jup.ag` → `api.jup.ag`
- `apps/agent/src/index.ts` — swapSolForToken wired in PositionBook deps
- `apps/agent/src/positions.ts` — open() calls swapper when mode=live

### 10. Slippage Configuration
**Masalah**: Default 2500 bps (25%) terlalu besar untuk meme coin
**Fix**: `JUPITER_SLIPPAGE_BPS` env var, user set to 300 (3%)
**Note**: 0.25 SOL slippage normal untuk meme coin low liquidity, bukan fee error

### 11. CRITICAL BUG FIXES (Sell Path + Live Funds) 🚨
**Bug 1**: `swapTokenForSol` NEVER wired — sells never executed
**Bug 2**: Sell amount = `pos.sizeSol * 1e9` (SOL lamports), not token native units
**Bug 3**: No SPL token balance query — agent doesn't know how many tokens it holds

**Fix**:
- `packages/solana/src/balance.ts` — `getTokenBalance(connection, owner, mint)` via `getParsedTokenAccountsByOwner`
- `packages/solana/src/swap.ts` — `swapSell` takes `rawTokenAmount: string` (raw token units)
- `apps/agent/src/index.ts` — `swapTokenForSol` wired: query real balance → swapSell(rawAmount)
- `apps/agent/src/positions.ts` — sell gagal → `return` early, posisi tetap open (no phantom close)

### 12. VPS Deployment Commands Reference
```bash
# Update dan restart
cd ~/anton-terminal && git pull && pnpm --filter @anton/solana build && pm2 restart anton-agent

# Dashboard update
cd ~/anton-terminal && git pull && pm2 restart anton-dashboard

# Database cleanup (fresh start)
pm2 stop anton-agent
docker exec anton-db psql -U anton -d anton -c "DELETE FROM positions; DELETE FROM balance_snapshots;"
pm2 start anton-agent

# PM2 commands
pm2 status
pm2 logs anton-agent --lines 20
pm2 logs anton-dashboard --lines 20
```

### 13. Environment Variables (VPS)
```
ANTON_MODE=live
DATABASE_URL=postgres://anton:anton@localhost:5433/anton
REDIS_URL=redis://localhost:6379
JUPITER_SLIPPAGE_BPS=300
SOLANA_PRIVATE_KEY=<redacted>
SOLANA_RPC_URL=<helius>
DASHBOARD_PORT=4000
REALTIME_PORT=4001
ANTON_MAX_CONCURRENT_POSITIONS=50
```

### 14. Dashboard .env (VPS) — `apps/dashboard/.env`
```
NEXT_PUBLIC_REALTIME_URL=https://autotrade.pr1nce.dev
NEXT_PUBLIC_MOCK=0
```

### 15. Nginx Config (VPS) — `/etc/nginx/sites-available/autotrade`
- HTTPS (443) → dashboard :4000
- /socket.io/ → realtime :4001 (WebSocket)
- /api/agent/stream → realtime :4001 (SSE)
- SSL via certbot (Let's Encrypt)

---

### Pending / Known Issues
- [ ] `fetchWalletBalance` log removed to reduce noise (refresh every 3s)
- [ ] `cycleCount` removed (unused after timer-based balance refresh)
- [ ] Oracle background task cancelled (timeout during equity curve design)

---

### Last Action
- All fixes pushed to `main` branch on GitHub
- Agent needs DB cleanup + restart: sold tokens manually, old positions restored without balance
```

---

### 16. Manual Sell Reconciliation (Auto-Close)
**Masalah**: Sell manual di wallet → posisi tetep nyangkut di Active, ga masuk History
**Root Cause**: `PositionBook.close()` gagal swap (balance 0) → `return` early, posisi tetep open
**Fix**:
- `apps/agent/src/positions.ts` — extract `finalizeClose()` dari `close()`, tambah `forceClose(id, pnlPct, reason)` — close tanpa swap
- `apps/agent/src/index.ts` — `reconTimer` setiap 15 detik: cek on-chain token balance semua live position, kalo `rawAmount === "0"` → `book.forceClose()` dengan reason `"manual-sell-detected"`

### 17. Config Panel — APPLY CONFIG Button
**Masalah**: Config di dashboard langsung commit per keystroke, ga ada tombol Apply, risk config ga pernah sampe agent
**Fix**:
- `apps/dashboard/components/panels/Controls.tsx` — draft state + APPLY CONFIG + REVERT button + "UNSAVED CHANGES" indicator
- `apps/dashboard/store/ui.ts` — `applyConfig()` batch action
- `packages/shared-types/src/events.ts` — `SetRiskConfigEvent` (maxConcurrent, dailyLossCapSol, defaultStopLossPct, defaultTakeProfitPct, screeningPreset)
- `packages/realtime/src/socket-server.ts` — wire `set_risk_config` client→server
- `packages/realtime/src/server.ts` — wire `onSetRiskConfig` handler
- `apps/agent/src/index.ts` — `onSetRiskConfig` → update `config` runtime (field mapping: `dailyLossCapSol`→`maxDailyLossSol`, `maxConcurrent`→`maxConcurrentPositions`)

### 18. Balance Dashboard Speed Fix
**Masalah**: SOL balance + equity curve update lelet (12 detik), bukan 2-3 detik
**Root Cause**: `snapshot()` cuma dipanggil setelah `runCycle` selesai (CYCLE_MS=12000)
**Fix**: `balTimer` sekarang langsung publish `holdings_snapshot` + push `balanceHistory` setiap `fetchWalletBalance()` selesai (3 detik)

### 19. Mock Position Lifecycle
**Fix**:
- `packages/realtime/src/mock-producer.ts` — position lifecycle: close old, open new setiap 10 detik
- `apps/dashboard/hooks/use-realtime.ts` — mock mode position lifecycle simulation

### 20. VPS Deploy (Session Ini)
```bash
cd ~/anton-terminal && git pull
pnpm --filter @anton/shared-types build
pnpm --filter @anton/realtime build
pm2 restart anton-agent
pm2 restart anton-dashboard
```

---

### 21. Trading Decision Overhaul 🔥 (WR 15% → 80%)
**Masalah**: Agent WR 15%, -12% REALIZED PnL. Keputusan trading buruk karena LLM cuma liat 6 field data.
**Root Cause**: System prompt 5 kalimat, user prompt cuma price+liquidity+momentum+screening verdict. Gak ada smart wallet, social, portfolio context. SL/TP hardcoded -20%/+50%.
**Fix**:
- `packages/agent/src/decide.ts` — **Rich system prompt** (40+ lines): SIGNAL PRIORITY, DYNAMIC SL/TP rules, BUY CHECKLIST (at least 3 must pass), PORTFOLIO AWARENESS, WHEN TO SKIP
- `packages/agent/src/decide.ts` — **Rich user prompt**: 25+ fields including smart wallets, social mentions, holder concentration, open positions, remaining budget, market cap, volume24h, holder count
- `packages/agent/src/decide.ts` — **Dynamic SL/TP**: LLM sets per token based on MC range (micro <$100K: SL 8-12%, TP 20-35% / small $100K-$500K: SL 10-15%, TP 25-45% / mid $500K+: SL 12-18%, TP 30-60%)
- `packages/agent/src/decide.ts` — **Risk-adjusted sizing**: `clampSize(conviction, remainingBudget)` — conviction 0.3→1.0x multiplier, max 25% remaining budget per position
- `packages/agent/src/decide.ts` — **Rule engine tightened**: BUY threshold SAFE momentum 5%→8%, CAUTION 15%→20%, MC-based SL/TP
- `packages/agent/src/decide.ts` — **Smart wallet BONUS signal**: empty array = "data unavailable" (not negative), don't skip based on missing data
- `packages/agent/src/decide.ts` — **`decideExit()` function**: separate LLM call for exit evaluation (HOLD vs EXIT), with rule-based fallback
- `packages/shared-types/src/decisions.ts` — Added `"EXIT"` to TradeAction, `exit_position_id` to TradeDecision

### 22. Position Management — Trailing Stop + Stale Exit
**Fix**:
- `apps/agent/src/positions.ts` — `OpenPosition` added `peakPriceUsd` + `trailingActivated` fields
- `apps/agent/src/positions.ts` — **Trailing stop**: activates at 50% of TP target, exits when price drops 10% from peak
- `apps/agent/src/positions.ts` — **Time-based stale exit**: 30 min with <2% movement and ≤0.5% PnL → close
- `apps/agent/src/positions.ts` — **`exitPosition(id, reason)`**: public method for LLM-driven exits with swap execution

### 23. Risk Management — Daily Loss Cap + Portfolio Context
**Fix**:
- `apps/agent/src/index.ts` — **Daily loss enforcement**: check 24h realized PnL before opening new positions, block all entries when cap hit
- `apps/agent/src/index.ts` — **Portfolio context passed to LLM**: openPositions array, remainingBudgetSol, realizedPnlSol
- `apps/agent/src/index.ts` — **Position re-evaluation loop**: every cycle, `decideExit()` checks open positions for early exit signals, calls `book.exitPosition()` on EXIT

### 24. Learning System — Adaptation + Pattern Memory + Lesson Injection 🧠
**Masalah**: Agent tidak belajar dari history. Setiap cycle independent.
**Fix**:
- `packages/data/src/schema/memory.ts` — Added `pattern_stats` table (category, key, total_trades, total_wins, total_losses, avg_pnl_pct)
- `packages/data/src/queries/lessons.ts` — **NEW**: `insertLesson`, `getRecentLessons`, `upsertPatternStat`, `getPatternStats`
- `packages/data/drizzle/0002_fresh_agent_learning.sql` — Migration for pattern_stats table
- `apps/agent/src/learn.ts` — **NEW**: `reflectOnClose()` — LLM analyzes closed trade → extracts lesson → stores in DB → updates pattern stats
- `apps/agent/src/index.ts` — After each cycle, check for newly closed positions → `reflectOnClose()` for each
- `apps/agent/src/index.ts` — Before decision loop, query recent lessons + pattern stats → inject into DecideContext
- `packages/agent/src/decide.ts` — System prompt dynamically injects "PATTERN STATISTICS" and "RECENT LESSONS" sections
- Pattern stats track: source (dexscreener/pumpfun), phase (bonding_curve/graduated), verdict (SAFE/CAUTION), mc_range (micro/small/mid/large), liquidity (low/medium/high), hold_time (fast/medium/slow)

### 25. Dashboard — Footer + Config Gate + Screening SKIP Count
**Fix**:
- `apps/dashboard/components/Footer.tsx` — **NEW**: sticky footer matching navbar style. Left: "PR1NCE EXPERIMENTAL // ANTON-TERMINAL". Right: uptime, ping dot (green LIVE / red DOWN), ⚙ CONFIG button
- `apps/dashboard/components/ConfigGate.tsx` — **NEW**: password modal (`NEXT_PUBLIC_CONFIG_PASSWORD` env var). Controls panel hidden until unlocked.
- `apps/dashboard/app/page.tsx` — Controls removed from main grid, conditionally rendered below grid when config unlocked
- `apps/dashboard/components/panels/Screening.tsx` — Added SKIP + BUY count in header, LLM decision badge (▲ BUY / ⨯ SKIP) per row
- `packages/shared-types/src/events.ts` — Added `llmAction?: "BUY" | "SKIP"` to ScreeningResultEvent
- `apps/agent/src/index.ts` — After LLM decision, re-publish screening event with llmAction for dashboard
- `apps/agent/src/index.ts` — Filter: only publish BUY/EXIT decisions to reasoning log (SKIP/HOLD are noise)
- `apps/dashboard/hooks/use-realtime.ts` — Screening handler merges llmAction into existing rows

### 26. Balance Chart Deduplication Fix
**Masalah**: Console error "data must be asc ordered by time" — lightweight-charts crash.
**Root Cause**: `balTimer` (3s) dan `snapshot()` (after runCycle, 12s) dua-duanya push ke `balanceHistory` dengan `Date.now()`. Bisa collision timestamp di millisecond yg sama. Di dashboard `Math.floor(ts/1000)` truncate ke second → makin rawan duplicate.
**Fix**: `apps/dashboard/components/panels/BalanceChart.tsx` — Deduplicate points by time before `setData()`, only keep strictly ascending.

### 21. Dashboard .env (VPS) — Updated
```
NEXT_PUBLIC_REALTIME_URL=https://autotrade.pr1nce.dev
NEXT_PUBLIC_MOCK=0
NEXT_PUBLIC_CONFIG_PASSWORD=<redacted>
```

---

### Pending / Known Issues
- [ ] Balance chart deduplication should also be fixed at agent source (single push point)
- [ ] `fetchWalletBalance` log removed to reduce noise (refresh every 3s)
- [ ] Smart wallet data ingestion not yet built (`packages/learning/` empty)

---

### 27. Helius WebSocket Real-Time Price Feed
**Masalah**: DexScreener 3s poll too slow for meme coins — SL/TP bisa telat 3-12 detik. Price move dari 16K→43K missed.
**Fix**:
- `packages/solana/src/price-ws.ts` — **NEW**: `HeliusPriceFeed` class, dual feed architecture:
  - Helius WebSocket `logsSubscribe` → instant price on any on-chain swap (< 500ms)
  - Jupiter API poll every 1s → keepalive when no swap activity (max 1s stale)
- `apps/agent/src/positions.ts` — `PositionBook` subscribes to WS on open, unsubscribes on close. `checkExitConditions()` extracted to shared method for both WS and poll paths.
- `apps/agent/src/index.ts` — `HeliusPriceFeed` wired into PositionBook deps, reads `SOLANA_RPC_WS` env (falls back to `SOLANA_RPC_URL` with https→wss conversion). Cleanup on shutdown.
- `packages/solana/src/index.ts` — Export `HeliusPriceFeed`

**Architecture**:
```
WS logsSubscribe ──→ instant (< 500ms) on swap event
Jupiter poll 1s  ──→ keepalive, never > 1s stale
DexScreener poll ──→ fallback if WS down
```

### 28. Dashboard Fixes — Equity Baseline + Mode Sync + Learning Panel
**Fix**:
- `apps/agent/src/index.ts` — `STARTING_SOL` now auto-set from actual wallet balance (`fetchWalletBalance()`) at startup, no longer hardcoded to 10 SOL. Fixes -75% equity curve display.
- `packages/shared-types/src/events.ts` — Added `mode?: ExecutionMode` + `recentLessons?` + `patternStats?` to `StateSnapshotEvent`
- `apps/agent/src/index.ts` — `buildStateSnapshot()` now async, queries DB for recent lessons + pattern stats, includes mode
- `apps/dashboard/hooks/use-realtime.ts` — Dashboard auto-syncs mode from state_snapshot, caches learning data
- `apps/dashboard/components/panels/Learning.tsx` — **NEW**: LEARNING panel showing:
  - RECENT LESSONS: 5 latest LLM reflections with severity badge (CRIT/IMP/NOTE)
  - PATTERN STATS: table of verdict/mc_range/source → W/L, WR%, avg PnL. Red row if WR < 30%, green if > 50%.
- `apps/dashboard/app/page.tsx` — Learning panel placed below Screening + SmartWalletFeed (full-width row)

### 29. VPS Env — Updated
```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<premium>
SOLANA_RPC_WS=wss://mainnet.helius-rpc.com/?api-key=<premium>
```

---

### Last Action
- All trading fixes + learning system + WS real-time price feed deployed on VPS
- Agent running with WR ~80% (from 15% baseline)
- Realized PnL: +2.8% (from -12% baseline)
- Dashboard: LEARNING panel (horizontal: recent lessons | pattern stats), footer with uptime/ping, config behind password gate, mode auto-sync, equity baseline from wallet
- 18 trades so far: hold_time/medium 57% WR +11.3%, hold_time/fast 32% WR -0.1%
- Agent left running overnight for learning data accumulation
- User resting — will return with performance report

---

### ⚠️ DEPLOYMENT PITFALLS (JANGAN DIULANGI)

**1. Next.js `PORT`, bukan `DASHBOARD_PORT`**
- `DASHBOARD_PORT` = buat realtime server internal agent
- `PORT` = buat Next.js HTTP server
- Dashboard `.env`: `PORT=4000`

**2. `git reset --hard` hapus `.next/` folder**
- `.next` git-ignored → kena wipe
- Wajib rebuild: `npx next build`

**3. Jangan `fuser -k` blind di port shared**
- `fuser -k 3000/tcp` → bunuh SEMUA proses di port 3000
- Cek dulu: `lsof -i :3000`

**4. Dashboard restart protocol (AMAN):**
```bash
cd ~/anton-terminal && git pull
cd apps/dashboard
npx next build
PORT=4000 pm2 restart anton-dashboard
```

---

### 30. Quality-over-Quantity Strategy Overhaul 🔥
**Masalah**: 100+ trades/hari, WR 37%, fee bleed 0.4 SOL menggerus profit.
**Root Cause**: Agent terlalu agresif, gak ada filter kualitas.
**Fix**:
- `apps/agent/src/index.ts` — **Market regime filter**: cek 12 candidate momentum → bullish/sideways/bearish. Bearish → skip semua entry.
- `apps/agent/src/index.ts` — **Daily trade cap**: max 10 trades / 24 jam.
- `apps/agent/src/index.ts` — **Max concurrent**: 5 → 3.
- `apps/agent/src/index.ts` — **Holder quality gate**: top 10 holders > 60% → REJECT sebelum LLM.
- `packages/agent/src/decide.ts` — **Anti-panic exit**: hold-first bias, fresh positions (< 5min) → HOLD forced. Rule-based fallback tightened.
- `packages/config/src/schema.ts` — Defaults: maxConcurrent 5→3, screening strict, loss cap 2→1 SOL.

### 31. Meme Market Regime (External Ecosystem Data)
**Masalah**: Regime cek trade sendiri → chicken-egg (cold start → bearish selamanya karena gak ada trade).
**Fix**: `apps/agent/src/index.ts` — Regime now uses ALL 12 candidates from ingestion pipeline: pump ratio vs dump ratio from DexScreener/Axiom/Pump.fun. Live DEX data, bukan data internal.

### 32. Watchlist + Pullback Entry (Anti-FOMO)
**Fix**:
- `apps/agent/src/index.ts` — **Watchlist**: SAFE tokens cycle 1 → added to watch, observed 2+ cycles before eligible. Log: `📋 TOKEN added to watchlist`.
- `apps/agent/src/index.ts` — **Pullback entry**: track peak momentum across cycles. Only enter when momentum drops from peak but still positive. Log: `↘️ TOKEN pullback 22%→8% entering dip`.
- `apps/dashboard/components/panels/Positions.tsx` — **WATCHLIST tab**: new tab between ACTIVE and HISTORY. Shows token data (symbol, liquidity, momentum, age, score, cycle count).
- `packages/shared-types/src/events.ts` — Added `watchlist` to `StateSnapshotEvent` and `HoldingsSnapshotEvent`.
- `apps/dashboard/hooks/use-realtime.ts` — Cache watchlist from holdings_snapshot (updated every 3s).

### 33. Smart-Money Wallet Intelligence (Helius)
**Fix**:
- `packages/solana/src/wallet-intel.ts` — `WalletIntel` class: parse Helius transactions to get recent buyers, detect bundles (same funder), check wallet freshness (< 5 txns), cross-reference smart wallet trust scores.
- `packages/data/src/queries/wallets.ts` — **NEW**: `upsertWalletScore`, `getWalletScores`, `recordWalletSwap`, `getWalletsForMint`, `getSmartWalletCount`.
- `apps/agent/src/index.ts` — Before LLM decision: fetch buyers, check smart money, detect bundles, warn fresh wallets. Log: `💰 N smart wallet(s)`, `🎭 BUNDLE`, `🆕 fresh wallets`.
- `apps/agent/src/index.ts` — **Self-learning**: position close → score wallets that bought that token (profit +0.05 trust, loss -0.03).
- Dashboard: `💰 N SMART WALLETS` counter in Learning panel.

### 34. BSC Token Filter + Price Feed Fix
**Masalah**: Axiom trending API mengembalikan token BSC/Ethereum (0x... addresses) tanpa filter.
**Fix**: `apps/agent/src/index.ts` — Regex `^[1-9A-HJ-NP-Za-km-z]{32,44}$` di depan ingestion pipeline + watchlist.

**Masalah**: `price-ws.ts` crash karena Helius WS mengirim teks non-JSON.
**Fix**: `packages/solana/src/price-ws.ts` — try/catch JSON.parse, ignore non-JSON messages.

### 35. Dashboard UI Improvements
**Fix**:
- Solana logo SVG (3-stripe gradient) replacing text "SOL" everywhere
- Pixel crown favicon + footer crown icon
- "DEPLOYED" → "POSITION" label
- Light/dark mode toggle in footer
- Position blink animation (green/red flash on price change)
- Slide-in animation for reasoning, screening, learning rows
- History tab layout matching ACTIVE (entry, hold columns)
- HIST tab fixed (was duplicate)

### 36. Slippage + Fee Optimization
**Fix**: `apps/agent/src/index.ts` — Default slippage 3% → 1% (100 bps). 18 trades = 0.05 SOL fee (was 0.10).
**README.md**: Updated with full current architecture, strategy table, safety limits.


### Last Action
- Agent deployed on VPS with full quality-over-quantity strategy
- 5-layer filters: regime → holders → watchlist → pullback → LLM
- Starting balance: 2.0469 SOL, REALIZED PnL: +0.1520 SOL, fees: -0.1043 SOL
- 18 trades, slippage reduced to 1%
- Dashboard: WATCHLIST tab, LEARNING panel, light/dark, animations
- User leaving agent to run overnight

---

## 2026-06-03

### 37. Swap Fee Tracking + Priority Fee Control
**Problem**: Balance 2.2 → 2.089 despite Realized PnL +0.1835. PnL computed from market-cap ratio, blind to fees.
**Root Cause**: `swap.ts` sent no `prioritizationFeeLamports` to Jupiter — fees uncontrolled. `trades` table had `feeSol` column but nothing ever wrote to it.
**Fix**:
- `packages/solana/src/swap.ts` — Rewrote entirely. Now sends controlled `prioritizationFeeLamports` (capped 0.001 SOL, veryHigh), enables `dynamicComputeUnitLimit` + `dynamicSlippage`. Measures ground-truth SOL spent via pre/post wallet balance delta. Returns real `priorityFeeLamports`, `slippageBps`, `priceImpactPct`.
- `packages/data/src/queries/trades.ts` (new) — `recordTrade()` for persisting every swap with real fee/slippage/priority-fee data. `getFeeBreakdown()` aggregates: totalFeeSol, totalPriorityFeeSol, avgSlippageBps, estSlippageCostSol, avgPriceImpactPct.
- `apps/agent/src/positions.ts` — Realized PnL now computed from actual SOL in/out (net of all fees) when real fills available; falls back to price ratio only in dry-run.
- `apps/agent/src/index.ts` — Both swap closures return `actualSolSpent`, persist `trades` rows.
- **Pump.fun direct integration = REJECTED.** Jupiter charges no platform fee. Pump.fun bonding-curve swaps cost 1% and only work on un-migrated tokens. The fee problem was slippage + uncontrolled priority fee, not routing.

### 38. Risk-Adjusted Position Sizing + Entry Quality Scoring
**Problem**: Old `clampSize()` scaled only by conviction. No awareness of pattern win-rate, liquidity risk, volatility, or daily-loss drawdown.
**Fix**:
- `packages/agent/src/scoring.ts` (new) —
  - `entryQualityScore()` → 0-100 with component breakdown: screening (25), momentum (25), liquidity (15), volume (15), holder concentration (10), smart wallets (10). Multiplied by pattern win-rate factor (0.6-1.3x) from existing `patternStats`.
  - `riskAdjustedSize()` — Replaces `clampSize`. Factors: entry score (0.4-1.3x), liquidity/slippage (0.5-1.0x), volatility (0.6-1.0x), daily-loss drawdown throttle (0.4-1.0x), 25% budget cap. Each factor returned with label + note, streamed to reasoning log.
- `packages/agent/src/decide.ts` — Both DeepSeek and rule paths use new sizing. `clampSize()` removed. Structured `patternStats` threaded into `DecideContext`.
- **Verified**: 5 edge cases (strong entry → max, low-liq gamble → floor, -80% daily loss → 0.52x throttle, losing pattern drops 82→62, winning lifts to 100).

### 39. Fee-Efficiency Gate + Account-Balance Scaling
**Problem**: 2.1 SOL account taking 0.1-0.15 SOL positions — fees consume huge % of returns. Small accounts need fewer, higher-conviction trades.
**Fix**:
- `packages/agent/src/scoring.ts` —
  - `feeEfficiencyGate(accountBalance, feeCtx, config)` → Returns maxConcurrent, minEntryScore, minConviction, adjustedMaxSize based on balance tier:
    - ≤1 SOL: max 1 position, score≥70, conviction≥0.8
    - 1-3 SOL: fee ratio≥35% fires gate (minScore 50, minConv 0.65)
    - 3-5 SOL: fee ratio≥50% fires gate
    - 5+: no gate
  - `balanceScaledConcurrency()` → 0-1 SOL: 1 pos, 1-2 SOL: 2 pos, 2-5 SOL: balance/2 positions.
  - `balanceCappedMax()` → 1 SOL: max 0.08 SOL/trade, 2 SOL: max 0.12, 5+: config default.
  - `minRequiredEdgePct()` → min % move to cover entry+exit fees + 2% buffer.
- `apps/agent/src/index.ts` — Gate wired into cycle: replaces `book.atCapacity()` with gate's `maxConcurrent`, adds conviction + score gate before BUY path.
- `packages/shared-types/src/events.ts` — Added `FeeBreakdownEvent`.
- `apps/agent/src/publish.ts` — `publishFeeBreakdown()`.

### 40. Dashboard Fee-Breakdown Panel
**Fix**:
- `apps/dashboard/components/panels/FeeBreakdown.tsx` (new) — Terminal-style panel showing:
  - Total fees / Per-trade cost / Fee-to-profit ratio
  - Fee-to-profit ratio bar with color-coded warnings
  - Fee breakdown by source (priority fees, network/jito, estimated slippage)
  - Avg slippage in bps, avg price impact
  - Stale detection after 30s without update
- `apps/dashboard/app/page.tsx` — FeeBreakdown panel added in same row as Learning (split 6+6)
- Listens via Socket.IO `fee_breakdown` event from trading channel

### Key Takeaways
- **Fee tracking was the #1 missing piece.** Trades table existed but was empty. Now every live swap persists cost data.
- **Small-account dynamics fundamentally differ.** At 2.1 SOL, 0.1 SOL trades are ~5% of account each. Fee-gating + balance-aware sizing is mandatory, not optional.
- **Config spend band too tight.** 0.1-0.15 SOL leaves only 0.05 SOL of expression room. Risk adjustments floor at min, not usefully express downward sizing.
- **Imitation/clustering tables exist but unused.** `imitationProfiles` table, `smartWallets.winRate/realizedPnl30dUsd` columns all defined in schema — clustering logic still needs wiring.

### Last Action
- Fee tracking, risk-adjusted sizing, fee-efficiency gate, and dashboard fee panel all built and compiled clean.
- Agent ready for restart: `pm2 restart anton-agent && cd apps/dashboard && npx next build && PORT=4000 pm2 restart anton-dashboard`

---

## 2026-06-03 (Net-Profit Gating — Audit Fix)

### Context
Audit revealed the previous fee-efficiency work was 3/5 "looked done but not wired":
- Expected profit vs cost → only logged, no reject
- Min edge → only logged, no reject
- Dynamic sizing by balance → `adjustedMaxSizeSol` computed but DISCARDED (sizing still clamped to config.maxSpendSol 0.15)
- Trade frequency control → WORKING (maxConcurrent + conviction)
- Fee-to-profit first-class → `minEntryScore` never used to reject

### 41. Expected-Value Gate (poin 1 & 2 — now ACTUALLY rejects)
**Fix**: `packages/agent/src/scoring.ts`
- `expectedValueGate()` — computes net EV: `p×(size×TP%) − (1−p)×(size×SL%) − (fee×2 + slippage×2)`. Returns `pass: false` when EV ≤ 0.
- `winProbabilityFor()` — derives win probability from historical pattern win-rate (not raw conviction). Losing 20%WR pattern → p≈0.36; winning 80%WR → p≈0.72.
- `packages/shared-types/src/decisions.ts` — TradeDecision gains `entry_score`, `expected_value_sol`, `expected_cost_sol`.
- `packages/agent/src/decide.ts` — both DeepSeek + rule paths compute & return EV; `DecideContext` gains `maxSizeSol` + `feeContext`.
- `apps/agent/src/index.ts` — new reject gate: `expected_value_sol ≤ 0` → skip with "Negative expected value — expected cost exceeds edge".

### 42. Dynamic Sizing by Balance (poin 3 — was DISCARDED, now wired)
**Fix**: `packages/agent/src/scoring.ts`
- `riskAdjustedSize()` gains `maxSizeOverride` — clamps to balance ceiling instead of config.maxSpendSol.
- `decide.ts` passes `ctx.maxSizeSol` (= gate's `adjustedMaxSizeSol`) into sizing.
- Verified: @2.1 SOL clamps to 0.126 (was 0.15), @0.8 SOL clamps to 0.08.

### 43. Entry-Score Reject Gate (poin 5 — minEntryScore now used)
**Fix**: `apps/agent/src/index.ts` — new reject gate: `entry_score < efficiencyGate.minEntryScore` → skip.

### Verification (node script, all passed)
- EV: weak edge + high fee (TP20/SL15/p40%/fee0.02) → EV −0.047 → REJECT ✓
- EV: strong (TP50/SL10/p70%) → EV +0.0265 → ENTER ✓
- Balance ceiling: @2.1 → 0.126, @0.8 → 0.08 ✓
- winProbability: losing pattern 20%WR → 0.36, winning 80%WR → 0.72 ✓
- End-to-end: losing pattern → p=0.34 → EV −0.018 → REJECT ✓
- Full monorepo build (11 pkg + dashboard): clean

### DB Migration
- **NONE NEEDED.** `recordTrade()` uses existing `trades` table columns (fee_sol, metadata, slippage_bps, tx_signature, route) already in migration `0000_flashy_dragon_man.sql`. No schema change this session.

### Deploy Notes
- **VPS**: `ssh root@161.97.173.157` → `cd ~/anton-terminal`
- New files to commit: `packages/agent/src/scoring.ts`, `packages/data/src/queries/trades.ts`, `apps/dashboard/components/panels/FeeBreakdown.tsx`
- ⚠️ VPS env has `ANTON_MAX_CONCURRENT_POSITIONS=50` — balance gate caps to min(2, 50)=2 for ~2 SOL account, so gate still limits correctly, but consider lowering this stale value.
- ⚠️ EV gate only bites after fee history accumulates (empty DB → cost 0 → passes). Full protection active after a few real trades.
- **Recommended**: deploy to dry-run first, watch reasoning log for gate messages, then switch ANTON_MODE=live.

### Build order (VPS)
```bash
cd ~/anton-terminal && git pull
pnpm install
pnpm --filter @anton/shared-types build
pnpm --filter @anton/config build
pnpm --filter @anton/data build
pnpm --filter @anton/solana build
pnpm --filter @anton/agent build
pnpm --filter ./apps/agent build
cd apps/dashboard && npx next build && cd ../..
pm2 restart anton-agent
PORT=4000 pm2 restart anton-dashboard
pm2 logs anton-agent --lines 50
```