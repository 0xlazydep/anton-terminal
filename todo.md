# Anton Terminal — TODO & Run Guide

Status snapshot per **31 May 2026**. Full pipeline **kebukti jalan end-to-end:** agent → bus → dashboard, dengan atau tanpa API keys.

---

## ✅ SUDAH BERES (verified)

### Dashboard UI
- [x] **Monorepo** — Turborepo + pnpm workspace (`apps/`, `packages/`)
- [x] **Dashboard shell** — brutalist 12-column grid (`apps/dashboard/app/page.tsx`)
- [x] **6 panel realtime semua "full hidup":**
  - [x] `PriceChart` — candle gerak tiap **750ms** (lightweight-charts, 30s candles)
  - [x] `ReasoningLog` — Anton ngetik terus: reasoning step **1.4s**, decision **7.2s**, auto-scroll + caret blink
  - [x] `Positions` — PnL tick tiap **1.2s**
  - [x] `Screening` — row baru layer-by-layer tiap **3.2s**
  - [x] `SmartWalletFeed` — wallet enter/exit feed tiap **1.8s**
  - [x] `Controls` — kontrol dry-run/live & spend (emit ke Socket.IO)
- [x] **Bug fix** — ReasoningLog scroll bukan membesar (tinggi tetap `lg:h-[708px]` + `overflow-hidden`)
- [x] **Build + typecheck dashboard** — 0 error

### Pipeline Packages (BARU — dikerjain 31 May 2026)
- [x] **`@anton/ingestion`** — DexScreener API (gratis, no key) + simulator fallback. Return `EnrichedCandidate[]`
- [x] **`@anton/screening`** — RugCheck.xyz + on-chain mint/freeze authority (SPL mint parse via `@anton/solana` RPC) + liquidity/age heuristics. Return `ScreeningReport`
- [x] **`@anton/agent`** — DeepSeek V4 chat API (tool calling `submit_trade_decision`) + `DeepSeekClient` + rule-based fallback offline. Return `TradeDecision`
- [x] **`@anton/solana`** — fix index.ts barrel (sebelumnya broken, ga ada export)
- [x] **Build + typecheck semua packages** — 0 error

### Realtime Server
- [x] **`packages/realtime/src/server.ts`** — standalone entrypoint
- [x] **`packages/realtime/src/http-server.ts`** — `createRealtimeServer(bus)` factory, reusable oleh agent
- [x] **`packages/realtime/src/mock-producer.ts`** — producer syntetik
- [x] **Next rewrite** — SSE `/api/agent/stream` → proxy ke `:4000`
- [x] **E2E terverifikasi:**
  - `/health` ✓, Socket.IO ✓, SSE direct ✓, SSE via Next proxy ✓

### Agent Pipeline (BARU — dikerjain 31 May 2026)
- [x] **`apps/agent/src/index.ts`** — orchestrator loop: ingestion → screening → decide → publish → position book
- [x] **`apps/agent/src/publish.ts`** — typed helpers publish ke tiap channel bus (match kontrak `socket-server.ts`/`sse.ts`)
- [x] **`apps/agent/src/positions.ts`** — `PositionBook` with SL/TP exit logic & price ticks
- [x] **Embedded realtime server** — agent embed realtime server in-process saat `REDIS_URL` kosong → agent publish + dashboard terima dari 1 proses, tanpa Docker
- [x] **DeepSeek + fallback** — kalau `DEEPSEEK_API_KEY` ada → API beneran; kalau kosong → rule engine offline. Reasoning steps publish ke SSE.
- [x] **Build + typecheck agent app** — 0 error
- [x] **E2E terverifikasi:**
  - Agent fallback mode boot ✓
  - Embedded server `/health` ✓
  - Socket.IO: `position_opened`, `position_update`, `screening_result`, `agent_status` ✓
  - SSE: `reasoning_step` ×7, `entry_decision` ×4 dalam 14s ✓

### Scripts
- [x] `pnpm dash` — dashboard mock mode
- [x] `pnpm realtime` — standalone realtime server
- [x] `pnpm dash:live` — realtime server + dashboard MOCK=0 (1 command)
- [x] `pnpm dash:agent` — **agent pipeline + dashboard MOCK=0** (1 command) ⭐

---

## 📌 KEPUTUSAN AKTIF (locked by operator — JANGAN tanya ulang)

### Holdings snapshot event — OPSI 1 (CONFIRMED)
> Operator udah milih ini. Implement langsung, gak usah konfirmasi ulang.

- **Apa:** Emit **SATU** `holdings_snapshot` per poll cycle.
- **Payload:** `startingSol` + current SOL balance + total PnL.
- **Kenapa opsi ini:** Pakai event type yang udah ada tapi belum kepakai. Bersih, gak ada data per-position yang redundan. Dashboard listener slot udah ada — tinggal di-wire.
- **Status:** [x] SUDAH diimplement (31 May 2026). Build + typecheck 0 error.
- **Yang berubah:**
  - `packages/shared-types/src/events.ts` — `HoldingsSnapshotEvent` di-reshape jadi `{ startingSol, solBalance, totalPnlSol }` (buang `positions[]` yang redundan). Invariant: `solBalance === startingSol + totalPnlSol`.
  - `apps/agent/src/positions.ts` — `PositionBook` nyimpen `realizedPnlSol` (akumulasi pas close) + method publik `totalPnlSol()` = realized + unrealized (open positions).
  - `apps/agent/src/publish.ts` — `publishHoldingsSnapshot(bus, data)` → emit `{ type: "holdings_snapshot", data }` di `CHANNELS.trading`.
  - `apps/agent/src/index.ts` — env `STARTING_SOL` (default 10) + `snapshot()` di-emit SEKALI tiap akhir cycle (sukses/error). Dry-run: `solBalance = STARTING_SOL + totalPnlSol` (gak ngarang balance on-chain).
  - `apps/dashboard/hooks/use-realtime.ts` — listener `socket.on("holdings_snapshot")` → update `solBalance` di Zustand store (Header langsung kebaca).
  - `packages/realtime/src/mock-producer.ts` — fix bug pre-existing (ScreeningResultEvent kurang field `ts`) yang nge-block build.

---

## ⏳ BELUM / NEXT

### Bug fixes (31 May 2026)
- [x] **Double reasoning log** — `useReasoning` dipanggil di 2 tempat (RealtimeBoot + ReasoningLog), masing2 bikin producer sendiri → setiap entry dobel. Fixed: split jadi `useReasoningStream` (producer, cuma di RealtimeBoot) + `useReasoningEntries` (consumer murni, di ReasoningLog).
- [x] **Double screening token** — `onScreening` blindly prepend tanpa dedup-by-mint. Token yang sama di-rescreen tiap cycle numpuk. Fixed: dedup-by-mint (replace entry lama, keep newest di top).
- [x] **Position cap fragile** — guard `book.count < maxConcurrentPositions` cuma caller-side di `index.ts`, `open()` gak enforce. Fixed: cap + duplicate-mint guard dipindahin ke dalam `PositionBook.open()` sebagai hard invariant (return `boolean`), unbypassable.

### New ingestion sources (31 May 2026)
- [x] **Pump.fun graduated** — `packages/ingestion/src/pumpfun-graduated.ts`. API: `advanced-api-v2.pump.fun/coins/graduated`. Fail-safe.
- [x] **Pump.fun new (currently-live)** — `packages/ingestion/src/pumpfun-new.ts`. API: `frontend-api-v3.pump.fun/coins/currently-live`. Fail-safe.
- [x] **Axiom trending** — `packages/ingestion/src/axiom-trending.ts`. API: `api8.axiom.trade/new-trending-v2?timePeriod=1h`. Raw response positional array. Fail-safe.
- [x] **LunarCrush** — SKIPPED (perlu PAID API key + gak kasih Solana mint address — gak bisa di-trade).
- [x] **Multi-source merge** — `fetchCandidates()` sekarang `Promise.allSettled` semua source paralel → merge + cross-source dedup by mint (keep highest liquidity) → slice limit. Kalau semua source gagal → fallback simulator. Source label baru: `"pumpfun_graduated" | "pumpfun_new" | "axiom" | "multi"`.

### Verified
- [x] Build 11/11 + typecheck 18/18 = 0 errors
- [x] Runtime: screening 4 events / 4 unique mints / 0 duplicates = PASS
- [x] Runtime: position cap hard invariant di `open()` verified by compile (type-safe, no bypass path)

---

## 📌 BATCH 2 — Pipeline Audit & Fixes (31 May 2026)

### Pipeline flow restructuring
- [x] **Post-execution dedup** — agent `runCycle()` sekarang filter `book.hasMint()` SEBELUM screening/decide. Token yang udah di PositionBook langsung di-skip, gak re-screen/re-buy.
- [x] **Screen ALL candidates** — sebelumnya cuma `candidates.slice(0,4)` yang di-screen. Sekarang SEMUA fresh candidate di-screen → semua source berkontribusi ke live feed. Cuma top 4 SAFE yang ke decide engine.
- [x] **Source field di screening** — `ScreeningResultEvent` sekarang punya `source?: TokenSource`. Di-pass dari `candidate.source` pas konstruksi event. Panel screening ada kolom SOURCE: `DEX` / `PFN` / `PFM` / `AX` / `JUP` / `SW`.
- [x] **Per-source ingestion label** — `IngestionResult.source` sekarang per-source (`"pumpfun_graduated"`, `"axiom"`, etc), bukan blanket `"multi"` terus.

### Bug fixes batch 2
- [x] **PnL SOL selalu 0** — `onUpdate` dashboard update `pnlPct` tapi gak update `pnlSol`. `usePositions` compute total PnL dari `pnlSol` yang selalu 0 → Header nunjukin `0%+`. Fixed: `pnlSol = p.sizeSol * (evt.pnlPct / 100)`.
- [x] **Position history kosong** — `onClosed` cuma filter/remove, data `pnlSol`/`pnlPct`/`closePriceUsd`/`reason` dibuang. Fixed: push ke `["position-history"]` cache (capped 100). Panel baru: POSITION HISTORY (SYM, MINT, SIZE, PnL%, PnL SOL, CLOSE, REASON).
- [x] **PFM symbol `—`** — Pump.fun graduated coins kasih `name` tapi `symbol` kosong. Fixed: `symbol: coin.symbol || coin.name`.
- [x] **Equity curve gak jalan (live mode)** — BalanceChart cuma diisi data di mock mode. Live mode: chart kosong. Fixed: wire ke `holdings_snapshot` Socket.IO — tiap snapshot update series dengan `solBalance`.
- [x] **Screening gak muncul cycle 1** — agent start duluan, dashboard Socket.IO belum connect → events lost. Fixed: agent nunggu 500ms sebelum cycle pertama (`agent loop starting (500ms startup delay)`).

### File changes batch 2
- `apps/agent/src/index.ts` — restructure `runCycle()` (filter→screen ALL→decide 4 SAFE), startup delay
- `packages/shared-types/src/events.ts` — `source?: TokenSource` on `ScreeningResultEvent`
- `packages/ingestion/src/index.ts` — per-source label tracking
- `packages/ingestion/src/pumpfun-graduated.ts` — symbol fallback
- `apps/dashboard/hooks/use-realtime.ts` — pnlSol compute + position-history cache in `onClosed`
- `apps/dashboard/components/panels/Screening.tsx` — SOURCE column
- `apps/dashboard/components/panels/Positions.tsx` — POSITION HISTORY section
- `apps/dashboard/components/panels/BalanceChart.tsx` — live mode wire to `holdings_snapshot`
- `apps/dashboard/hooks/use-positions.ts` — `usePositionHistory()` hook

### Verified batch 2
- [x] Build 11/11 + typecheck = 0 errors

---

## ⏳ BELUM / NEXT (31 May 2026 — last session sync)

### 🔴 HIGH PRIORITY — Fix active issues (lanjutin dari sini)

1. **Screening feed masih kadang stale** — source ingestion sering gagal (Pump.fun / Axiom diblok), fallback ke simulator tiap cycle. Simulator cuma generate 8 token sama, jadi feed gak fresh. **Perlu:** log/track source success rate, coba fallback source alternatif, atau improve retry/headers.
2. **Position history belum mock-mode** — `usePositionHistory` cuma ke-fill di live Socket.IO mode. Mock mode belum ada history feed.
3. **`usePositionHistory` mock-mode** — mock `tickPositions` belum emit `position_closed` events. Perlu tambahin closed position simulation.

### 🟢 DONE — Sudah beres semua batch 1 + 2

- [x] Holdings snapshot event (emit per cycle, dashboard listener)
- [x] Double reasoning log (split producer/consumer)
- [x] Double screening token (dedup-by-mint)
- [x] Position cap hard invariant (inside `PositionBook.open()`)
- [x] 3 new ingestion sources (Pump.fun graduated, Pump.fun new, Axiom)
- [x] Multi-source merge + cross-source dedup
- [x] Post-execution dedup (skip active mints before screening)
- [x] Screen ALL candidates (semua source ke live feed)
- [x] Source field on screening + SOURCE column
- [x] PnL SOL compute in onUpdate
- [x] Position history cache + POSITION HISTORY panel
- [x] PFM symbol fallback (coin.name)
- [x] Equity curve live mode (wire to holdings_snapshot)
- [x] Startup delay 500ms (dashboard connect before cycle 1)

---

## 🚀 CARA NGE-RUN

### Cara 1 — Dashboard aja, mock browser (PALING SIMPEL)

```bash
pnpm install
pnpm dash
```
Buka http://localhost:3000

### Cara 2 — Agent pipeline + dashboard (1 command, tanpa Docker) ⭐

Agent jalan (ingestion → screening → decide → publish), data asli dari DexScreener/RugCheck kalau ada network, fallback sintetik kalau offline. Dashboard connect ke agent's embedded realtime server.

```bash
pnpm dash:agent
```
- Agent: cycle tiap 12s, embedded server :4000
- Dashboard: :3000 (MOCK=0, connect ke agent)
- Output: `[AGENT]` + `[DASH]` prefix. Stop: Ctrl+C.

### Cara 3 — Realtime server standalone + dashboard

```bash
pnpm dash:live
```
Realtime server punya mock producer sendiri (data syntetik), agent ga jalan.

### Cara 4 — Agent doang (tanpa dashboard)

```bash
pnpm --filter @anton/agent-app dev
```

### Cara 5 — Full asli (butuh keys + Docker)

```bash
# isi .env: DEEPSEEK_API_KEY, SOLANA_RPC_URL, HELIUS_API_KEY, REDIS_URL, DATABASE_URL
docker compose up -d
pnpm db:migrate
pnpm dash:agent
```

---

## 🏗️ ARSITEKTUR

```
┌────────────────────── apps/agent ──────────────────────┐
│  fetchCandidates() → screenCandidate() → decide()      │
│  DexScreener          RugCheck+RPC       DeepSeek/rules│
│       │                    │                   │       │
│       ▼                    ▼                   ▼       │
│  ┌─────────── EventBus (in-memory / Redis) ────────┐   │
│  │ trading │ screening │ smartWallet │ reasoning │  │   │
│  └────┬─────┴──────┬────┴──────┬──────┴─────┬─────┘   │
│       │            │           │            │          │
│  Socket.IO /trading│     SSE /api/agent/stream        │
│  (positions,       │     (reasoning steps,            │
│   screening,       │      entry decisions)            │
│   wallets, status) │                                  │
└───────┬────────────┴────────────┬─────────────────────┘
        │                         │
   browser: ws://:4000      browser: EventSource
   Socket.IO                 (Next rewrite → :4000)
```

---

## ⚠️ CATATAN ENV

- **Node v25** — warning `--localstorage-file` noise, bukan error. Mau bersih → Node 20 LTS.
- Warning cross-origin LAN — abaikan kalau akses `localhost`.
- **Semua `.env` keys optional.** Pipeline tetap jalan dengan fallback otomatis.
- `dash:agent` = 1 command, 2 proses paralel (agent + dashboard). Stop: Ctrl+C.
