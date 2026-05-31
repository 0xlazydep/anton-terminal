# Anton Terminal — System Architecture

> Autonomous Solana meme coin trading agent. DeepSeek brain, on-chain smart-money learning, persistent memory, cyberpunk/brutalist B&W dashboard.

**Status:** Design v1.0 · **Verified:** May 2026 · **Stack:** TypeScript monorepo (Node 20+)

---

## 1. Vision & Core Principles

Anton is a **self-aware autonomous trader** that:

1. **Sources** new/trending meme tokens from Pump.fun, Jupiter, DexScreener, and Twitter/X.
2. **Learns** by tracking profitable on-chain "smart money" wallets — imitating their entry, TP, and SL behavior.
3. **Reasons** with DeepSeek V4 — generating a natural-language rationale for EVERY decision (entry, SL, hold, skip).
4. **Remembers** — persistent episodic memory (lessons learned), identity ("Anton"), and operator memory (knows who calls it).
5. **Executes** fast scalps (~0.1 SOL/position, many concurrent entries) via Jupiter + Jito MEV protection.
6. **Screens** every candidate for rugs/honeypots before risking capital.
7. **Reports** to a professional realtime dashboard (black & white, cyberpunk + brutalism + minimal).

### Design Principles

| Principle | Meaning |
|---|---|
| **Reason-first** | No trade without a stored, human-readable rationale. Auditable always. |
| **Dry-run parity** | Dry-run and live share the SAME code path. Only the final `submitTransaction` differs. |
| **Fail-safe defaults** | Default = HOLD/SKIP. Unknown state = no trade. Hard caps on spend & daily loss. |
| **Learn continuously** | Every closed position triggers a Reflexion loop → lesson stored → injected into future decisions. |
| **Layered safety** | On-chain checks → DexScreener → RugCheck → deep checks. Fail fast, fail cheap. |
| **Self-custody** | Hot wallet holds minimal SOL. Keys never leave the agent process. |

---

## 2. High-Level System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ANTON TERMINAL                               │
│                                                                      │
│  ┌────────────┐   ┌─────────────┐   ┌──────────────┐   ┌──────────┐  │
│  │ INGESTION  │──▶│  SCREENING  │──▶│  AGENT CORE  │──▶│ EXECUTION │  │
│  │  (sources) │   │  (safety)   │   │ (DeepSeek)   │   │ (Jupiter) │  │
│  └─────┬──────┘   └─────────────┘   └──────┬───────┘   └────┬─────┘  │
│        │                                    │                │        │
│        │          ┌──────────────┐          │                │        │
│        └─────────▶│ SMART-WALLET │──────────┤                │        │
│                   │   LEARNING   │          │                │        │
│                   └──────────────┘          │                │        │
│                                             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  STATE & MEMORY: PostgreSQL+TimescaleDB+pgvector · Redis      │    │
│  │  - trades/positions  - OHLCV ticks  - lessons (vectors)      │    │
│  │  - identity/user mem  - hot state    - job queues (BullMQ)   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              │                                        │
│              Socket.IO (trading) + SSE (reasoning)                   │
│                              ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  DASHBOARD (Next.js · B&W cyberpunk/brutalist · JetBrains Mono)│    │
│  │  positions · PnL · live screening · agent reasoning · controls│    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Decision Loop (Heart of Anton)

Every cycle (default 30s, plus event-driven triggers from websockets):

```
1. INGEST    → New/trending tokens from sources + smart-wallet swap events
2. SCREEN    → Safety pipeline (mint/freeze auth, LP, holders, honeypot)
3. ENRICH    → Price, liquidity, momentum, social signal, smart-wallet context
4. RECALL    → Pull relevant past lessons from memory (semantic search)
5. REASON    → DeepSeek decides: {action, token, size, confidence, reason, sl, tp}
6. GATE      → Hard rules: spend caps, daily loss, dedup, mode (dry/live)
7. EXECUTE   → Jupiter build → sign → (Jito) submit  [OR simulate if dry-run]
8. MONITOR   → Track position; SL/TP watcher; smart-wallet exit mirroring
9. REFLECT   → On close: Reflexion → lesson → store → curate
10. EMIT     → Stream every step to dashboard (reasoning log + position updates)
```

Each decision produces a **DecisionRecord** persisted to DB and streamed to the UI, containing the full rationale.

---

## 4. Module Map

| Module | Package | Responsibility | Key Doc |
|---|---|---|---|
| Ingestion | `packages/ingestion` | Token sourcing (Pump.fun WS, Jupiter, DexScreener, Twitter) | `02-DATA-SOURCES.md` |
| Smart-Wallet Learning | `packages/learning` | Track smart money, reconstruct TP/SL, derive imitation signals | `04-LEARNING.md` |
| Screening | `packages/screening` | Multi-layer rug/honeypot safety pipeline | `06-SCREENING.md` |
| Agent Core | `packages/agent` | DeepSeek reasoning, tool-calling loop, decision schema | `03-AGENT-CORE.md` |
| Memory | `packages/memory` | Reflexion lessons, identity, user memory (pgvector/Mem0) | `05-MEMORY.md` |
| Execution | `packages/execution` | Jupiter swaps, Jito, priority fees, slippage, dry-run | `07-EXECUTION.md` |
| Data | `packages/data` | DB schema, TimescaleDB OHLCV, Drizzle ORM, ingest writers | `08-DATA-MODEL.md` |
| Scheduler | `packages/scheduler` | BullMQ queues, trading cycle, reflection jobs | `03-AGENT-CORE.md` |
| Solana | `packages/solana` | RPC client, wallet, tx assembly, ALTs | `07-EXECUTION.md` |
| Realtime | `packages/realtime` | Socket.IO + SSE servers, event bus | `09-DASHBOARD.md` |
| Dashboard | `apps/dashboard` | Next.js B&W cyberpunk UI | `09-DASHBOARD.md` |
| Config | `packages/config` | Trading config, presets, env, secrets | `10-CONFIG-DEPLOY.md` |

---

## 5. Technology Stack (Final Decisions)

| Layer | Choice | Why |
|---|---|---|
| **LLM brain** | DeepSeek `deepseek-v4-flash` (default) + `deepseek-v4-pro` (deep) | OpenAI-compatible, 1M context, tool-calling, reasoning mode, cheap |
| **Agent runtime** | Mastra (`@mastra/core`) | TS-native, durable workflows, first-class memory, AI-SDK based (DeepSeek works) |
| **Streaming to UI** | Vercel AI SDK + SSE | Token streaming of reasoning |
| **Token source (launches)** | PumpPortal WebSocket (`subscribeNewToken`/`subscribeMigration`) | Free, realtime, no RPC infra |
| **Token source (trending)** | Jupiter Tokens API v2 + DexScreener + Birdeye | `toptrending`, `recent`, boosts |
| **Social signal** | DexScreener/Birdeye trending + Apify cashtag scraper + LunarCrush | Cost-optimized; skip raw X API |
| **Smart-wallet feed** | Helius Enhanced Webhooks + Cielo WS + (scale) Shyft/Helius gRPC | Parsed swaps, low latency |
| **Smart-money discovery** | GMGN (free) + Birdeye top_traders + Nansen (premium) | Wallet universe |
| **Price oracle** | Jupiter Price API v3 + Birdeye | Batched USD prices |
| **Execution** | Jupiter Swap V2 `/build` (no platform fee) + own RPC | Full tx control, zero fee |
| **MEV / landing** | Jito `dontfront` + `sendTransaction` (bundleOnly) | Sandwich protection |
| **Priority fees** | Helius `getPriorityFeeEstimate` (High/75th pct) | Dynamic fee |
| **RPC** | Helius (staked + gRPC); fallback QuickNode/AllenHark | SWQoS, Yellowstone |
| **Screening** | On-chain RPC → DexScreener → RugCheck → Birdeye/GoPlus/Bubblemaps | Layered safety |
| **DB** | PostgreSQL 16 + TimescaleDB + pgvector | One DB: relational + timeseries + vectors |
| **Hot state / queues** | Redis 7 + BullMQ | Positions, pending orders, schedule |
| **ORM** | Drizzle ORM | Type-safe, Postgres-first |
| **Frontend** | Next.js 16 (App Router) + React + Tailwind 4 + shadcn/ui | Hybrid SSR + interactive |
| **Realtime transport** | Socket.IO (trading) + SSE (reasoning) | Bidi + server push |
| **Charts** | TradingView Lightweight Charts + Recharts | Canvas candlesticks, PnL bars |
| **State** | TanStack Query (server) + Zustand (UI) | Cache + minimal UI store |
| **Font/Theme** | JetBrains Mono, zero-radius, OKLCH B&W tokens | Brutalist terminal aesthetic |
| **Monorepo** | Turborepo + pnpm | Shared types across agent + UI |

---

## 6. Documentation Index

| File | Contents |
|---|---|
| `ARCHITECTURE.md` | This file — overview, principles, stack, decision loop |
| `02-DATA-SOURCES.md` | Token sourcing: Pump.fun, Jupiter, DexScreener, Twitter signal |
| `03-AGENT-CORE.md` | DeepSeek integration, tool-calling, decision schema, ReAct loop, scheduler |
| `04-LEARNING.md` | Smart-wallet tracking, TP/SL reconstruction, imitation strategy |
| `05-MEMORY.md` | Reflexion lessons, identity, user memory, pgvector schema |
| `06-SCREENING.md` | Multi-layer rug/honeypot safety pipeline |
| `07-EXECUTION.md` | Jupiter swaps, Jito, priority fees, slippage, dry-run/live |
| `08-DATA-MODEL.md` | Full DB schema (trades, positions, OHLCV, lessons, wallets) |
| `09-DASHBOARD.md` | Frontend architecture, realtime events, B&W design system |
| `10-CONFIG-DEPLOY.md` | Config schema, env, secrets, Docker, deployment, risk caps |
| `11-ROADMAP.md` | Phased build plan (MVP → full autonomy) |

---

## 7. Key Risk & Cost Notes

**Monthly infra (entry tier):** ~$200–350/mo
- Helius Developer/Business (RPC + webhooks + gRPC)
- DexScreener (free) + Birdeye Starter ($99) + Cielo Builder ($89, optional)
- DeepSeek: ~$0.30 per 1,000 decision cycles on v4-flash (negligible at start)
- Jupiter Developer ($25)
- Apify cashtag scraper (~$5)

**Hard safety caps (config-enforced, see `10-CONFIG-DEPLOY.md`):**
- `maxPositionSizeSol` (default 0.1), `maxConcurrentPositions`, `maxDailyLossSol`, `minLiquidityUsd`, `maxTokenAgeReject`, `requireMintFreezeRevoked`.

**This is a high-risk domain.** Anton is built dry-run-first. Live trading is gated behind explicit operator opt-in and hard caps.
