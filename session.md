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

### Last Action
- All trading fixes + learning system deployed on VPS
- Agent running with WR ~80% (from 15% baseline)
- Realized PnL: -0.0019 SOL (-0.37%) — massive improvement from -12% baseline
- Dashboard: footer with uptime/ping, config behind password gate, screening SKIP/BUY count
- Agent left running for multi-hour observation

