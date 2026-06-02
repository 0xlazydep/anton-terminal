import { z } from "zod";

export const tradingConfigSchema = z.object({
  mode: z.enum(["dry-run", "live"]).default("dry-run"),

  minSpendSol: z.number().min(0.001).default(0.1),
  maxSpendSol: z.number().min(0.001).default(0.15),
  defaultSizeSol: z.number().min(0.001).default(0.12),

  maxConcurrentPositions: z.number().int().min(1).default(3),
  maxEntriesPerMinute: z.number().int().min(1).default(6),
  preventDuplicateMint: z.boolean().default(true),

  maxDailyLossSol: z.number().min(0).default(1),
  defaultStopLossPct: z.number().default(-20),
  defaultTakeProfitPct: z.number().default(50),
  trailingStop: z.boolean().default(false),

  screeningPreset: z.enum(["strict", "normal", "relaxed"]).default("strict"),
  minLiquidityUsd: z.number().default(8000),
  minTokenAgeSec: z.number().default(60),
  requireMintFreezeRevoked: z.literal(true).default(true),

  slippageNewLaunchBps: z.number().default(2000),
  slippageEstablishedBps: z.number().default(500),

  imitationEnabled: z.boolean().default(true),
  minWalletTrust: z.number().min(0).max(1).default(0.6),
  mirrorExits: z.boolean().default(true),

  approvalRequired: z.boolean().default(false),
  approvalThresholdSol: z.number().default(0.5),
});

export type TradingConfig = z.infer<typeof tradingConfigSchema>;

export function parseTradingConfig(input: unknown = {}): TradingConfig {
  return tradingConfigSchema.parse(input);
}

export const defaultTradingConfig: TradingConfig = tradingConfigSchema.parse({});
