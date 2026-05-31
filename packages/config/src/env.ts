import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function resolveRootEnvPath(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return join(dir, ".env");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  ANTON_MODE: z.enum(["dry-run", "live"]).default("dry-run"),
  LOG_LEVEL: z.string().default("info"),

  DEEPSEEK_API_KEY: z.string().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  EMBEDDINGS_BASE_URL: z.string().default("https://api.openai.com/v1"),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),

  JUPITER_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  BIRDEYE_API_KEY: z.string().optional(),
  PUMPPORTAL_API_KEY: z.string().optional(),
  CIELO_API_KEY: z.string().optional(),
  RUGCHECK_API_KEY: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
  LUNARCRUSH_API_KEY: z.string().optional(),
  GMGN_API_KEY: z.string().optional(),

  SOLANA_RPC_URL: z.string().optional(),
  SOLANA_RPC_WS: z.string().optional(),
  SOLANA_GRPC_URL: z.string().optional(),
  SOLANA_PRIVATE_KEY: z.string().optional(),

  DATABASE_URL: z.string().default("postgres://anton:anton@localhost:5432/anton"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  DASHBOARD_PORT: z.coerce.number().default(3000),
  REALTIME_PORT: z.coerce.number().default(3005),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const rootEnv = resolveRootEnvPath();
  loadDotenv(rootEnv ? { path: rootEnv } : undefined);
  cached = envSchema.parse(process.env);
  return cached;
}
