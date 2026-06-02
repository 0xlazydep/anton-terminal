# Anton Terminal

> Autonomous Solana meme coin trading agent with adaptive AI learning.

DeepSeek V4 brain analyses real-time DEX data, screens for safety, detects smart-money wallets via Helius, learns from every trade, and executes via Jupiter swaps. Quality-over-quantity strategy with anti-FOMO watchlist, pullback entry timing, and meme-ecosystem market regime detection.

> **High-risk software.** Trades real money on volatile assets. Built with hard safety caps. Live trading is opt-in only. Use at your own risk.

---

## Strategy

| Layer | Description |
|-------|-------------|
| **Ingestion** | DexScreener trending + Pump.fun + Axiom — 12 candidates/cycle |
| **Market Regime** | Live ecosystem scan: pumping vs dumping token ratio → bullish/sideways/bearish |
| **Screening** | On-chain (mint/freeze authority) + RugCheck + holder concentration gate (top10 > 60% reject) |
| **Wallet Intel** | Helius transaction parsing: recent buyers, bundle detection, fresh wallet check, smart-money scoring |
| **Watchlist** | Anti-FOMO: tokens observed 2+ cycles before eligible entry |
| **Entry Timing** | Pullback strategy: enter on momentum dip from peak, not FOMO top |
| **LLM Decision** | Rich context (25+ fields): smart wallets, holders, portfolio, pattern stats, lessons → dynamic SL/TP |
| **Exit** | Trailing stop (MC-adaptive 8-15%), stale position timeout (30min), LLM re-evaluation (hold-first bias) |
| **Learning** | Position close → LLM reflection → lesson stored. Pattern stats (W/L per category). Wallet trust scoring (self-learning) |

## Safety

| Limit | Value |
|-------|-------|
| Max concurrent positions | 3 |
| Max trades per day | 10 |
| Daily loss cap | 1 SOL |
| Cold start | BEARISH mode (no entries until data) |
| Anti-FOMO | 2-cycle watchlist observation + pullback entry |
| Profit exit cooldown | 30 min |
| Loss exit cooldown | 5 min |
| Trailing stop | 8-15% (market cap adaptive) |

## Dashboard

| Panel | Description |
|-------|-------------|
| **Balance Chart** | Real-time SOL equity curve |
| **Agent Reasoning** | Live SSE stream of LLM decisions + reasoning |
| **ACTIVE / WATCH / HISTORY** | Positions, watchlisted tokens, closed trades |
| **Live Screening** | SAFE/CAUTION/REJECT + BUY/SKIP decisions + holder gate |
| **Learning** | Recent lessons + pattern stats (W/L, WR%, avg PnL) + smart wallet counter |
| **Footer** | Uptime, ping, light/dark toggle, config gate (password-protected) |

---

## Architecture

```
anton-terminal/
├── apps/
│   ├── agent/          # Trading loop (entrypoint)
│   └── dashboard/      # Next.js B&W terminal UI
├── packages/
│   ├── shared-types/   # Cross-package type contract
│   ├── config/         # Zod trading config + presets + env
│   ├── data/           # Drizzle ORM (PostgreSQL)
│   ├── ingestion/      # DexScreener, Pump.fun, Axiom sources
│   ├── screening/      # On-chain + RugCheck safety
│   ├── agent/          # DeepSeek reasoning + decide/exit functions
│   ├── memory/         # Lessons, pattern stats, smart wallets (pg)
│   ├── solana/         # RPC, wallet, swap, price-ws, wallet-intel
│   └── realtime/       # Socket.IO + SSE event bus
└── docs/
```

## Stack

DeepSeek V4 · Jupiter Swap API · Helius RPC/WebSocket · DexScreener API · RugCheck · PostgreSQL · Next.js 15 + Tailwind · Socket.IO + SSE · TypeScript monorepo (pnpm)

---

## Quick Start

### Prerequisites
- Node.js 22+
- pnpm 9+
- Docker (PostgreSQL)

### Setup

```bash
pnpm install
cp .env.example .env          # fill in API keys
docker compose up -d          # PostgreSQL
pnpm db:migrate               # apply schema
```

### Run

```bash
pnpm dev                      # agent (port 4001) + dashboard (port 4000)
```

Dashboard: http://localhost:4000

---

## Environment

```env
ANTON_MODE=live
DEEPSEEK_API_KEY=sk-...
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
SOLANA_RPC_WS=wss://mainnet.helius-rpc.com/?api-key=...
SOLANA_PRIVATE_KEY=[...]
DATABASE_URL=postgres://anton:anton@localhost:5433/anton
JUPITER_SLIPPAGE_BPS=300
NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
NEXT_PUBLIC_CONFIG_PASSWORD=pr1nce-terminal
```

## Deploy (VPS)

```bash
cd ~/anton-terminal && git pull
pnpm --filter @anton/shared-types build
pnpm --filter @anton/data build
pnpm --filter @anton/solana build
pnpm --filter @anton/agent build
pm2 restart anton-agent
cd apps/dashboard && npx next build && PORT=4000 pm2 restart anton-dashboard
```
