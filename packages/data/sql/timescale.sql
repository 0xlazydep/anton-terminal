-- TimescaleDB + pgvector setup that drizzle-kit cannot generate.
-- Run AFTER `drizzle-kit migrate` has created the base tables.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert token_ticks into a hypertable partitioned on time.
SELECT create_hypertable('token_ticks', 'time', if_not_exists => TRUE);

-- 1-minute OHLCV continuous aggregate.
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  mint,
  first(price_usd, time) AS open,
  max(price_usd) AS high,
  min(price_usd) AS low,
  last(price_usd, time) AS close,
  sum(tx_count) AS volume
FROM token_ticks
GROUP BY bucket, mint
WITH NO DATA;

SELECT add_continuous_aggregate_policy('ohlcv_1m',
  start_offset => INTERVAL '5 minutes',
  end_offset => INTERVAL '30 seconds',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE);

-- Compress raw ticks older than 2 hours.
ALTER TABLE token_ticks SET (timescaledb.compress, timescaledb.compress_segmentby = 'mint');
SELECT add_compression_policy('token_ticks', compress_after => INTERVAL '2 hours', if_not_exists => TRUE);

-- HNSW index for semantic lesson recall (cosine).
CREATE INDEX IF NOT EXISTS idx_lessons_embedding_hnsw
  ON lessons USING hnsw (embedding vector_cosine_ops);
