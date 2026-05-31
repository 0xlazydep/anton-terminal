# Anton Terminal

> Autonomous Solana meme coin trading agent. DeepSeek brain · on-chain smart-money learning · persistent memory · cyberpunk/brutalist B&W dashboard.

Anton sources new and trending meme tokens (Pump.fun, Jupiter, DexScreener, Twitter), screens them for rugs/honeypots, reasons with **DeepSeek V4** to decide every trade — producing a natural-language rationale for each entry, stop-loss, hold, or skip — learns from profitable on-chain "smart money" wallets, remembers lessons across sessions, and executes fast scalps with MEV protection. Dry-run first.

> **High-risk software.** Trades real money on volatile assets. Built dry-run-first with hard safety caps. Live trading is opt-in only. Use at your own risk.

---

## Architecture

Full design lives in [`docs/`](./docs):

| Doc | Topic |
|---|---|
| [ARCHITECTURE](./docs/ARCHITECTURE.md) | Overview, decision loop, stack |
| [02-DATA-SOURCES](./docs/02-DATA-SOURCES.md) | Token sourcing |
| [03-AGENT-CORE](./docs/03-AGENT-CORE.md) | DeepSeek brain |
| [04-LEARNING](./docs/04-LEARNING.md) | Smart-wallet learning |
| [05-MEMORY](./docs/05-MEMORY.md) | Lessons, identity, operator memory |
| [06-SCREENING](./docs/06-SCREENING.md) | Rug/honeypot safety |
| [07-EXECUTION](./docs/07-EXECUTION.md) | Swaps, Jito, dry-run |
| [08-DATA-MODEL](./docs/08-DATA-MODEL.md) | Database schema |
| [09-DASHBOARD](./docs/09-DASHBOARD.md) | Realtime UI |
| [10-CONFIG-DEPLOY](./docs/10-CONFIG-DEPLOY.md) | Config, secrets, deploy |
| [11-ROADMAP](./docs/11-ROADMAP.md) | Build phases |

---

## Monorepo Layout

```
anton-terminal/
├── apps/
│   ├── agent/          # long-running trading process (entrypoint)
│   └── dashboard/      # Next.js B&W cyberpunk terminal
├── packages/
│   ├── shared-types/   # cross-package type contract
│   ├── config/         # Zod trading config + presets + env
│   ├── data/           # Drizzle schema (Postgres + TimescaleDB + pgvector)
│   ├── ingestion/      # token sources (Pump.fun, Jupiter, DexScreener, social)
│   ├── screening/      # rug/honeypot safety pipeline
│   ├── agent/          # DeepSeek reasoning core
│   ├── memory/         # lessons (pgvector) + identity + operator
│   ├── learning/       # smart-wallet tracking + imitation
│   ├── solana/         # RPC, wallet, tx assembly
│   ├── execution/      # Jupiter swaps + Jito + dry-run engine
│   ├── scheduler/      # BullMQ queues + workers
│   └── realtime/       # Socket.IO + SSE + Redis event bus
└── docs/
```

---

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker (for Postgres/TimescaleDB + Redis)

### Setup

```bash
pnpm install
cp .env.example .env          # fill in API keys (DeepSeek, Helius, Jupiter, ...)
docker compose up -d          # Postgres (TimescaleDB) + Redis + Bull Board
pnpm db:migrate               # apply schema
```

### Run (dry-run by default)

```bash
pnpm dev                      # agent + dashboard
```

- Dashboard: http://localhost:3000
- Bull Board (queues): http://localhost:3001

The dashboard runs in mock mode without a backend (`NEXT_PUBLIC_MOCK=1`) so you can preview the terminal UI immediately.

---

## Safety

- **Dry-run first.** `ANTON_MODE=dry-run` is the default. Dry-run and live share one code path; only final transaction submission differs.
- **Hard caps** (in `@anton/config`): max position size, max concurrent positions, daily loss cap, min liquidity, mint/freeze-authority-revoked requirement. The LLM can never exceed these.
- **Layered screening** rejects honeypots and rugs before any capital is risked.
- **Self-custody.** The hot wallet holds only a minimal trading budget; keys never leave the agent process.

Complete the [go-live checklist](./docs/10-CONFIG-DEPLOY.md#6--operational-safety-checklist-before-live) before enabling live trading.

---

## Stack

DeepSeek V4 (brain) · Mastra (agent runtime) · Jupiter Swap V2 + Jito (execution) · Helius (RPC/webhooks) · PostgreSQL + TimescaleDB + pgvector · Redis + BullMQ · Next.js + Tailwind + shadcn/ui · Socket.IO + SSE · TypeScript monorepo (Turborepo + pnpm).
