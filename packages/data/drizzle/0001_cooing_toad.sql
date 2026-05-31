CREATE TABLE IF NOT EXISTS "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"sol_balance" double precision NOT NULL,
	"starting_sol" double precision NOT NULL,
	"total_pnl_sol" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_balance_snapshots_ts" ON "balance_snapshots" USING btree ("ts");