CREATE TABLE IF NOT EXISTS "pattern_stats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category" text NOT NULL,
  "key" text NOT NULL,
  "total_trades" integer NOT NULL DEFAULT 0,
  "total_wins" integer NOT NULL DEFAULT 0,
  "total_losses" integer NOT NULL DEFAULT 0,
  "total_pnl_sol" double precision NOT NULL DEFAULT 0,
  "avg_pnl_pct" double precision NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone DEFAULT now()
);
