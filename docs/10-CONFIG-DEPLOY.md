# 10 — Config, Risk Caps, Secrets & Deployment

---

## 1. Trading Config Schema

The operator-tunable config (the "set config for entry" requirement). Validated with Zod; hard caps enforced server-side.

```typescript
// packages/config/src/schema.ts
import { z } from 'zod';

export const TradingConfig = z.object({
  mode: z.enum(['dry-run','live']).default('dry-run'),

  // Entry sizing (the "acuan" / reference)
  minSpendSol: z.number().min(0.001).default(0.05),
  maxSpendSol: z.number().min(0.001).default(0.1),
  defaultSizeSol: z.number().min(0.001).default(0.1),

  // Concurrency & throughput (scalping)
  maxConcurrentPositions: z.number().int().min(1).default(10),
  maxEntriesPerMinute: z.number().int().min(1).default(6),

  // Risk caps (hard, enforced regardless of LLM)
  maxDailyLossSol: z.number().min(0).default(2),
  defaultStopLossPct: z.number().default(-20),
  defaultTakeProfitPct: z.number().default(50),
  trailingStop: z.boolean().default(false),

  // Screening
  screeningPreset: z.enum(['strict','normal','relaxed']).default('normal'),
  minLiquidityUsd: z.number().default(8000),
  minTokenAgeSec: z.number().default(60),       // 0 in snipe mode
  requireMintFreezeRevoked: z.literal(true).default(true),

  // Slippage
  slippageNewLaunchBps: z.number().default(2000), // 20%
  slippageEstablishedBps: z.number().default(500),// 5%

  // Smart-wallet imitation
  imitationEnabled: z.boolean().default(true),
  minWalletTrust: z.number().min(0).max(1).default(0.6),
  mirrorExits: z.boolean().default(true),

  // Human-in-the-loop
  approvalRequired: z.boolean().default(false),
  approvalThresholdSol: z.number().default(0.5),
});
export type TradingConfig = z.infer<typeof TradingConfig>;
```

**Enforcement order:** LLM decision → **hard-cap gate** (this config) → execute. The agent can never exceed caps even if it "decides" to. Daily-loss cap hit → `emergency_stop` auto-fires for the day.

---

## 2. Environment / Secrets

```bash
# .env (never commit; use a secrets manager in prod)
DEEPSEEK_API_KEY=
JUPITER_API_KEY=
HELIUS_API_KEY=
BIRDEYE_API_KEY=
PUMPPORTAL_API_KEY=
CIELO_API_KEY=
RUGCHECK_API_KEY=          # optional (read endpoints are keyless)
APIFY_TOKEN=               # social scraper
LUNARCRUSH_API_KEY=        # optional
GMGN_API_KEY=              # optional

SOLANA_RPC_URL=            # Helius staked
SOLANA_RPC_WS=             # Helius ws
SOLANA_GRPC_URL=           # LaserStream / Shyft (scale)
SOLANA_PRIVATE_KEY=        # hot wallet (base58). MINIMAL funds only.

DATABASE_URL=              # postgres+timescale+pgvector
REDIS_URL=
EMBEDDINGS_API_KEY=        # for lesson embeddings
EMBEDDINGS_BASE_URL=
```

**Key handling:** hot wallet key loaded once at boot; never logged, never sent to UI. Cold/funding wallet key NEVER in the agent process.

---

## 3. Monorepo Layout

```
anton-terminal/
├── apps/
│   ├── agent/                 # long-running trading process
│   └── dashboard/             # Next.js UI
├── packages/
│   ├── ingestion/             # token sources (02)
│   ├── learning/              # smart-wallet (04)
│   ├── screening/             # safety (06)
│   ├── agent/                 # DeepSeek core (03)
│   ├── memory/                # lessons/identity (05)
│   ├── execution/             # swaps/jito (07)
│   ├── solana/                # rpc/wallet/tx (07)
│   ├── data/                  # schema/drizzle (08)
│   ├── scheduler/             # bullmq (03)
│   ├── realtime/              # socket.io + sse (09)
│   ├── shared-types/          # cross-package types
│   └── config/                # zod config, presets (10)
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 4. Docker Compose (Dev)

```yaml
# docker-compose.yml (sketch)
services:
  db:
    image: timescale/timescaledb-ha:pg16   # includes pgvector
    environment: [ POSTGRES_PASSWORD=anton ]
    ports: [ "5432:5432" ]
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
  redis:
    image: redis:7-alpine
    ports: [ "6379:6379" ]
  agent:
    build: ./apps/agent
    env_file: .env
    depends_on: [ db, redis ]
  dashboard:
    build: ./apps/dashboard
    ports: [ "3000:3000" ]
    depends_on: [ agent ]
  bullboard:
    image: deadly0/bull-board
    ports: [ "3001:3000" ]
volumes: { pgdata: {} }
```

Prod: agent as a resilient long-running service (systemd/K8s), dashboard on its own host, Socket.IO server co-located with agent (or separate process), Nginx reverse proxy with sticky sessions for WS.

---

## 5. Observability

- **Agent traces:** Mastra OpenTelemetry → Grafana/Tempo. Trace each decision cycle (ingest→screen→reason→execute→reflect).
- **PnL dashboards:** Grafana over Postgres (`positions`, `decisions`).
- **Queue health:** Bull Board (`:3001`).
- **Alerts:** daily-loss-cap hit, RPC failover, DeepSeek circuit-breaker open, land-rate drop, webhook gaps.
- **Audit log:** every `decisions` row = immutable record with rationale + context hash.

---

## 6. Operational Safety Checklist (before LIVE)

- [ ] Run ≥1 week in DRY-RUN; review decision rationales + simulated PnL.
- [ ] Verify hard caps fire (force a synthetic over-cap decision → must reject).
- [ ] Confirm honeypot test rejects a known honeypot mint.
- [ ] Confirm emergency stop halts entries and (optionally) flattens.
- [ ] Hot wallet funded with ONLY the day's risk budget.
- [ ] Failover RPC tested (kill primary → secondary takes over).
- [ ] DeepSeek circuit-breaker → defaults to HOLD on outage.
- [ ] Operator approval flow tested for entries > threshold.
