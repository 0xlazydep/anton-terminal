CREATE TYPE "public"."trade_action" AS ENUM('BUY', 'SELL', 'HOLD', 'SKIP', 'SET_SL', 'SET_TP');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('dry-run', 'live');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED', 'SIMULATED');--> statement-breakpoint
CREATE TYPE "public"."swap_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."lesson_severity" AS ENUM('critical', 'important', 'note');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now(),
	"mint" text NOT NULL,
	"symbol" text,
	"action" "trade_action" NOT NULL,
	"size_sol" double precision,
	"confidence" double precision NOT NULL,
	"reason" text NOT NULL,
	"stop_loss_pct" double precision,
	"take_profit_pct" double precision,
	"risk_flags" text[],
	"model_used" text,
	"screening_score" double precision,
	"smart_wallets" text[],
	"mode" "execution_mode" NOT NULL,
	"position_id" uuid,
	"reasoning_trace" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mint" text NOT NULL,
	"symbol" text,
	"entry_trade" uuid,
	"exit_trade" uuid,
	"size_sol" double precision NOT NULL,
	"entry_price_usd" double precision,
	"entry_market_cap_usd" double precision,
	"exit_price_usd" double precision,
	"stop_loss_pct" double precision,
	"take_profit_pct" double precision,
	"pnl_sol" double precision,
	"pnl_pct" double precision,
	"max_drawdown_pct" double precision,
	"hold_seconds" integer,
	"mode" "execution_mode" NOT NULL,
	"status" "position_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now(),
	"closed_at" timestamp with time zone,
	"episode" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mint" text NOT NULL,
	"symbol" text,
	"direction" "trade_direction" NOT NULL,
	"size_sol" double precision NOT NULL,
	"price_usd" double precision,
	"price_sol" double precision,
	"token_amount" double precision,
	"slippage_bps" integer,
	"fee_sol" double precision,
	"tx_signature" text,
	"route" text,
	"mode" "execution_mode" NOT NULL,
	"status" "trade_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"confirmed_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "trades_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imitation_profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"median_tp_pct" double precision,
	"median_sl_pct" double precision,
	"scale_out" boolean,
	"median_hold_sec" integer,
	"recent_win_rate" double precision,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smart_wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"label" text,
	"win_rate" double precision,
	"realized_pnl_30d_usd" double precision,
	"avg_hold_seconds" integer,
	"trade_count_30d" integer,
	"trust" double precision DEFAULT 0.5,
	"active" boolean DEFAULT true,
	"last_evaluated" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_swaps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"mint" text NOT NULL,
	"side" "swap_side" NOT NULL,
	"sol_amount" double precision,
	"token_amount" double precision,
	"price_usd" double precision,
	"signature" text,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_swaps_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_identity" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"severity" "lesson_severity" NOT NULL,
	"embedding" vector(1024),
	"trade_ids" uuid[],
	"source" text DEFAULT 'trade',
	"retired" boolean DEFAULT false,
	"retired_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_ticks" (
	"time" timestamp with time zone NOT NULL,
	"mint" text NOT NULL,
	"source" text NOT NULL,
	"price_sol" double precision,
	"price_usd" double precision,
	"volume_5m" double precision,
	"liquidity" double precision,
	"tx_count" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decisions" ADD CONSTRAINT "decisions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_entry_trade_trades_id_fk" FOREIGN KEY ("entry_trade") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_exit_trade_trades_id_fk" FOREIGN KEY ("exit_trade") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imitation_profiles" ADD CONSTRAINT "imitation_profiles_wallet_smart_wallets_address_fk" FOREIGN KEY ("wallet") REFERENCES "public"."smart_wallets"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_swaps" ADD CONSTRAINT "wallet_swaps_wallet_smart_wallets_address_fk" FOREIGN KEY ("wallet") REFERENCES "public"."smart_wallets"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_decisions_mint_time" ON "decisions" USING btree ("mint","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_positions_open" ON "positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trades_mint_time" ON "trades" USING btree ("mint","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_swaps_wallet_time" ON "wallet_swaps" USING btree ("wallet","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_swaps_mint_time" ON "wallet_swaps" USING btree ("mint","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lessons_category" ON "lessons" USING btree ("category");