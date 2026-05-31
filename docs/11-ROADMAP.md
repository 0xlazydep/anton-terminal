# 11 — Build Roadmap (Phased)

Dry-run-first. Each phase ships something testable. Live trading only after Phase 5 + safety checklist.

---

## Phase 0 — Foundation (scaffold)
- Turborepo + pnpm monorepo, `shared-types`, `config` (Zod), Drizzle.
- Postgres+TimescaleDB+pgvector + Redis via Docker Compose.
- DB schema (08) migrated. Health checks.
- **Exit:** `pnpm dev` boots agent + dashboard shells; DB reachable.

## Phase 1 — Data In (ingestion + price)
- PumpPortal WS (`subscribeNewToken`/`subscribeMigration`).
- Jupiter trending/recent + DexScreener + Birdeye polling.
- Candidate normalize + dedup + enrich (Jupiter Price v3).
- TimescaleDB tick writer + `ohlcv_1m`.
- **Exit:** live candidate stream visible in logs/DB; OHLCV populating.

## Phase 2 — Screening
- Layer 1 on-chain (mint/freeze/top-10) → Layer 2 DexScreener → Layer 3 RugCheck.
- Layer 4 deep (Birdeye holder tags, GoPlus, Jupiter honeypot test) for high-conviction.
- `ScreeningReport` + caching + dashboard screening events.
- **Exit:** candidates get SAFE/CAUTION/REJECT with reasons; honeypot test rejects a known bad mint.

## Phase 3 — Agent Brain (DeepSeek) — DRY-RUN
- DeepSeek client, tool registry, `submit_trade_decision` (strict).
- ReAct loop (Mastra workflow), two-tier model selection, resilience (circuit-breaker).
- Decision persistence + rationale streaming (SSE).
- BullMQ scheduler (30s cycle + event fast-path).
- **Exit:** Anton produces full decisions with rationale in DRY-RUN; every action explained.

## Phase 4 — Memory
- pgvector lessons + Reflexion loop (reflect on simulated closes).
- Identity (Anton) + operator memory; system-prompt injection.
- Lesson curator (retire/merge).
- **Exit:** Anton recalls relevant lessons; remembers operator by name; lessons improve later decisions.

## Phase 5 — Smart-Wallet Learning
- Discover universe (GMGN/Birdeye/Nansen/Cielo) → `smart_wallets`.
- Helius Enhanced Webhooks + Cielo WS tracking → `wallet_swaps`.
- Position reconstruction → `imitation_profiles` (TP/SL behavior).
- `get_smart_wallet_context` tool + mirror-exit monitor.
- **Exit:** Anton cites smart-wallet basis in rationales; mirrors exits in DRY-RUN.

## Phase 6 — Execution (LIVE-capable)
- Jupiter `/build` → v0 tx + ALTs + `dontfront`.
- Helius priority fee + simulate-for-CU + Jito `sendTransaction` (bundleOnly).
- Dry-run parity engine; SL/TP monitor; slippage presets.
- **Exit:** DRY-RUN fills realistic; LIVE path code-complete behind opt-in + hard caps.

## Phase 7 — Dashboard (full)
- B&W cyberpunk/brutalist design system (JetBrains Mono, zero-radius, OKLCH).
- Panels: chart (Lightweight Charts), reasoning (SSE), positions, screening, controls, smart-wallet feed.
- Socket.IO + SSE wiring; TanStack Query + Zustand; config controls round-trip.
- **Exit:** operator watches Anton reason in realtime, toggles dry/live, sets spend caps.
- **Delegate:** `visual-engineering` + `ui-ux-pro-max` + `ckm:ui-styling`.

## Phase 8 — Hardening & Go-Live
- Observability (OTel/Grafana, Bull Board), alerts, RPC failover.
- Run ≥1 week DRY-RUN; review rationales + simulated PnL.
- Complete safety checklist (10 §6). Fund hot wallet minimally.
- **Exit:** controlled LIVE with tiny caps; scale gradually.

---

## Dependency Order

```
P0 → P1 → P2 → P3 → P4
                 └──→ P5 ──┐
                 └──→ P6 ──┼─→ P7 → P8
                           │
   (P4/P5/P6 partly parallel after P3)
```

## Parallelization Opportunities
- After P3: P4 (memory), P5 (learning), P6 (execution) can progress in parallel by separate agents.
- P7 (dashboard) can start its design system early (visual-engineering) and wire events as backend stabilizes.

## First Implementation Slice (when you say "build")
1. P0 scaffold + DB schema.
2. P1 PumpPortal + Jupiter ingestion.
3. P3 minimal DeepSeek decision (SKIP/HOLD/BUY) in DRY-RUN with rationale.
This gives an end-to-end dry-run loop fastest, then layer screening/memory/learning/execution/dashboard.
