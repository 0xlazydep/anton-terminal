# 08 — Data Model

One PostgreSQL 16 instance with TimescaleDB (time-series) + pgvector (memory). Redis for hot state and queues. Drizzle ORM.

---

## 1. Storage Map

| Data | Store | Why |
|---|---|---|
| Trades, positions, decisions | Postgres (relational) | ACID, joins, audit |
| OHLCV / price ticks | TimescaleDB hypertables | partitioning, continuous aggregates, compression |
| Lessons (embeddings) | pgvector | semantic recall |
| Identity / user / wallets | Postgres JSONB + tables | config + curated universe |
| Open position cache, pending orders, dedup | Redis | sub-ms hot state, TTL |
| Job queues / schedule | Redis + BullMQ | retries, repeatable jobs |
| Event bus (intra-service) | Redis Pub/Sub | realtime fan-out |

---

## 2. Core Relational Schema

```sql
-- TRADES (each on-chain swap leg)
CREATE TABLE trades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint          TEXT NOT NULL,
  symbol        TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('BUY','SELL')),
  size_sol      DOUBLE PRECISION NOT NULL,
  price_usd     DOUBLE PRECISION,
  price_sol     DOUBLE PRECISION,
  token_amount  DOUBLE PRECISION,
  slippage_bps  INTEGER,
  fee_sol       DOUBLE PRECISION,
  tx_signature  TEXT UNIQUE,
  route         TEXT,                 -- 'jupiter' | 'pump' | 'pump-amm'
  mode          TEXT NOT NULL CHECK (mode IN ('dry-run','live')),
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','CONFIRMED','FAILED','SIMULATED')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  confirmed_at  TIMESTAMPTZ,
  metadata      JSONB
);
CREATE INDEX idx_trades_mint_time ON trades (mint, created_at DESC);

-- POSITIONS (entry/exit lifecycle)
CREATE TABLE positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint          TEXT NOT NULL,
  symbol        TEXT,
  entry_trade   UUID REFERENCES trades(id),
  exit_trade    UUID REFERENCES trades(id),
  size_sol      DOUBLE PRECISION NOT NULL,
  entry_price_usd DOUBLE PRECISION,
  exit_price_usd  DOUBLE PRECISION,
  stop_loss_pct  DOUBLE PRECISION,
  take_profit_pct DOUBLE PRECISION,
  pnl_sol       DOUBLE PRECISION,
  pnl_pct       DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION,
  hold_seconds  INTEGER,
  mode          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opened_at     TIMESTAMPTZ DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  episode       JSONB                 -- serialized TradeEpisode for reflection
);
CREATE INDEX idx_positions_open ON positions (status) WHERE status = 'OPEN';

-- DECISIONS (every agent decision + rationale)
CREATE TABLE decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            TIMESTAMPTZ DEFAULT now(),
  mint          TEXT NOT NULL,
  symbol        TEXT,
  action        TEXT NOT NULL CHECK (action IN ('BUY','SELL','HOLD','SKIP','SET_SL','SET_TP')),
  size_sol      DOUBLE PRECISION,
  confidence    DOUBLE PRECISION NOT NULL,
  reason        TEXT NOT NULL,              -- the rationale (always present)
  stop_loss_pct DOUBLE PRECISION,
  take_profit_pct DOUBLE PRECISION,
  risk_flags    TEXT[],
  model_used    TEXT,                       -- 'flash' | 'pro'
  screening_score DOUBLE PRECISION,
  smart_wallets TEXT[],
  mode          TEXT NOT NULL,
  position_id   UUID REFERENCES positions(id),
  reasoning_trace TEXT
);
CREATE INDEX idx_decisions_mint_time ON decisions (mint, ts DESC);
```

---

## 3. Smart-Wallet Tables

```sql
CREATE TABLE smart_wallets (
  address         TEXT PRIMARY KEY,
  label           TEXT,
  win_rate        DOUBLE PRECISION,
  realized_pnl_30d_usd DOUBLE PRECISION,
  avg_hold_seconds INTEGER,
  trade_count_30d INTEGER,
  trust           DOUBLE PRECISION DEFAULT 0.5,
  active          BOOLEAN DEFAULT true,
  last_evaluated  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wallet_swaps (
  id          BIGSERIAL PRIMARY KEY,
  wallet      TEXT NOT NULL REFERENCES smart_wallets(address),
  mint        TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  sol_amount  DOUBLE PRECISION,
  token_amount DOUBLE PRECISION,
  price_usd   DOUBLE PRECISION,
  signature   TEXT UNIQUE,
  ts          TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_wallet_swaps_wallet_time ON wallet_swaps (wallet, ts DESC);
CREATE INDEX idx_wallet_swaps_mint_time   ON wallet_swaps (mint, ts DESC);

-- imitation profiles (derived behavior)
CREATE TABLE imitation_profiles (
  wallet          TEXT PRIMARY KEY REFERENCES smart_wallets(address),
  median_tp_pct   DOUBLE PRECISION,
  median_sl_pct   DOUBLE PRECISION,
  scale_out       BOOLEAN,
  median_hold_sec INTEGER,
  recent_win_rate DOUBLE PRECISION,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. TimescaleDB — OHLCV / Ticks

```sql
CREATE TABLE token_ticks (
  time        TIMESTAMPTZ NOT NULL,
  mint        TEXT NOT NULL,
  source      TEXT NOT NULL,        -- 'jupiter' | 'birdeye' | 'pumpfun'
  price_sol   DOUBLE PRECISION,
  price_usd   DOUBLE PRECISION,
  volume_5m   DOUBLE PRECISION,
  liquidity   DOUBLE PRECISION,
  tx_count    INTEGER
);
SELECT create_hypertable('token_ticks','time');

CREATE MATERIALIZED VIEW ohlcv_1m WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', time) AS bucket, mint,
       first(price_usd, time) AS open, max(price_usd) AS high,
       min(price_usd) AS low, last(price_usd, time) AS close,
       sum(tx_count) AS volume
FROM token_ticks GROUP BY bucket, mint;

SELECT add_continuous_aggregate_policy('ohlcv_1m',
  start_offset => INTERVAL '5 minutes', end_offset => INTERVAL '30 seconds',
  schedule_interval => INTERVAL '30 seconds');
SELECT add_compression_policy('token_ticks', compress_after => INTERVAL '2 hours');
```

Used for: charting (dashboard), pricing smart-wallet swap legs (PnL reconstruction), momentum features for the agent.

---

## 5. Memory Tables

(See `05-MEMORY.md` for full DDL.) Summary: `lessons` (pgvector HNSW), `agent_identity` (JSONB), `user_profile` (JSONB).

---

## 6. Redis Keys (Hot State)

| Key | Type | Use |
|---|---|---|
| `anton:seen:{mint}` | string (TTL 6h) | candidate dedup |
| `anton:pos:open` | hash | open positions snapshot (fast reads) |
| `anton:pending:{mint}` | string (TTL) | in-flight order lock (prevent double-entry) |
| `anton:dailyloss:{date}` | float | running daily loss vs cap |
| `anton:mode` | string | global dry-run/live |
| `anton:screening:{mint}` | json (TTL 2m) | cached screening report |
| BullMQ keys | — | queues: candidates/screening/decision/execution/reflection/monitor |

---

## 7. Data Retention

- `token_ticks`: compress after 2h, drop raw after 30d (keep `ohlcv_1m` aggregate longer).
- `decisions`, `trades`, `positions`: retain indefinitely (audit).
- `wallet_swaps`: retain 90d rolling (enough for behavior reconstruction).
- `lessons`: never deleted; retired lessons kept for audit.
