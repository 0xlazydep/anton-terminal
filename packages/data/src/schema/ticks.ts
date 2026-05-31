import { pgTable, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";

export const tokenTicks = pgTable("token_ticks", {
  time: timestamp("time", { withTimezone: true }).notNull(),
  mint: text("mint").notNull(),
  source: text("source").notNull(),
  priceSol: doublePrecision("price_sol"),
  priceUsd: doublePrecision("price_usd"),
  volume5m: doublePrecision("volume_5m"),
  liquidity: doublePrecision("liquidity"),
  txCount: integer("tx_count"),
});
