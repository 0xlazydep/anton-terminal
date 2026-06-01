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

