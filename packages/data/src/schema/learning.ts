import {
  pgTable,
  text,
  doublePrecision,
  integer,
  bigserial,
  boolean,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const swapSideEnum = pgEnum("swap_side", ["BUY", "SELL"]);

export const smartWallets = pgTable("smart_wallets", {
  address: text("address").primaryKey(),
  label: text("label"),
  winRate: doublePrecision("win_rate"),
  realizedPnl30dUsd: doublePrecision("realized_pnl_30d_usd"),
  avgHoldSeconds: integer("avg_hold_seconds"),
  tradeCount30d: integer("trade_count_30d"),
  trust: doublePrecision("trust").default(0.5),
  active: boolean("active").default(true),
  lastEvaluated: timestamp("last_evaluated", { withTimezone: true }).defaultNow(),
});

export const walletSwaps = pgTable(
  "wallet_swaps",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallet: text("wallet")
      .notNull()
      .references(() => smartWallets.address),
    mint: text("mint").notNull(),
    side: swapSideEnum("side").notNull(),
    solAmount: doublePrecision("sol_amount"),
    tokenAmount: doublePrecision("token_amount"),
    priceUsd: doublePrecision("price_usd"),
    signature: text("signature").unique(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
  },
  (t) => ({
    walletTimeIdx: index("idx_wallet_swaps_wallet_time").on(t.wallet, t.ts),
    mintTimeIdx: index("idx_wallet_swaps_mint_time").on(t.mint, t.ts),
  }),
);

export const imitationProfiles = pgTable("imitation_profiles", {
  wallet: text("wallet")
    .primaryKey()
    .references(() => smartWallets.address),
  medianTpPct: doublePrecision("median_tp_pct"),
  medianSlPct: doublePrecision("median_sl_pct"),
  scaleOut: boolean("scale_out"),
  medianHoldSec: integer("median_hold_sec"),
  recentWinRate: doublePrecision("recent_win_rate"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
