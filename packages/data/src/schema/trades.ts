import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const directionEnum = pgEnum("trade_direction", ["BUY", "SELL"]);
export const modeEnum = pgEnum("execution_mode", ["dry-run", "live"]);
export const tradeStatusEnum = pgEnum("trade_status", [
  "PENDING",
  "CONFIRMED",
  "FAILED",
  "SIMULATED",
]);
export const positionStatusEnum = pgEnum("position_status", ["OPEN", "CLOSED"]);
export const actionEnum = pgEnum("trade_action", [
  "BUY",
  "SELL",
  "HOLD",
  "SKIP",
  "SET_SL",
  "SET_TP",
]);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mint: text("mint").notNull(),
    symbol: text("symbol"),
    direction: directionEnum("direction").notNull(),
    sizeSol: doublePrecision("size_sol").notNull(),
    priceUsd: doublePrecision("price_usd"),
    priceSol: doublePrecision("price_sol"),
    tokenAmount: doublePrecision("token_amount"),
    slippageBps: integer("slippage_bps"),
    feeSol: doublePrecision("fee_sol"),
    txSignature: text("tx_signature").unique(),
    route: text("route"),
    mode: modeEnum("mode").notNull(),
    status: tradeStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    mintTimeIdx: index("idx_trades_mint_time").on(t.mint, t.createdAt),
  }),
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mint: text("mint").notNull(),
    symbol: text("symbol"),
    entryTrade: uuid("entry_trade").references(() => trades.id),
    exitTrade: uuid("exit_trade").references(() => trades.id),
    sizeSol: doublePrecision("size_sol").notNull(),
    entryPriceUsd: doublePrecision("entry_price_usd"),
    entryMarketCapUsd: doublePrecision("entry_market_cap_usd"),
    exitPriceUsd: doublePrecision("exit_price_usd"),
    stopLossPct: doublePrecision("stop_loss_pct"),
    takeProfitPct: doublePrecision("take_profit_pct"),
    pnlSol: doublePrecision("pnl_sol"),
    pnlPct: doublePrecision("pnl_pct"),
    maxDrawdownPct: doublePrecision("max_drawdown_pct"),
    holdSeconds: integer("hold_seconds"),
    mode: modeEnum("mode").notNull(),
    status: positionStatusEnum("status").notNull().default("OPEN"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    episode: jsonb("episode"),
  },
  (t) => ({
    openIdx: index("idx_positions_open").on(t.status),
  }),
);

export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    solBalance: doublePrecision("sol_balance").notNull(),
    startingSol: doublePrecision("starting_sol").notNull(),
    totalPnlSol: doublePrecision("total_pnl_sol").notNull(),
  },
  (t) => ({
    tsIdx: index("idx_balance_snapshots_ts").on(t.ts),
  }),
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow(),
    mint: text("mint").notNull(),
    symbol: text("symbol"),
    action: actionEnum("action").notNull(),
    sizeSol: doublePrecision("size_sol"),
    confidence: doublePrecision("confidence").notNull(),
    reason: text("reason").notNull(),
    stopLossPct: doublePrecision("stop_loss_pct"),
    takeProfitPct: doublePrecision("take_profit_pct"),
    riskFlags: text("risk_flags").array(),
    modelUsed: text("model_used"),
    screeningScore: doublePrecision("screening_score"),
    smartWallets: text("smart_wallets").array(),
    mode: modeEnum("mode").notNull(),
    positionId: uuid("position_id").references(() => positions.id),
    reasoningTrace: text("reasoning_trace"),
  },
  (t) => ({
    mintTimeIdx: index("idx_decisions_mint_time").on(t.mint, t.ts),
  }),
);
