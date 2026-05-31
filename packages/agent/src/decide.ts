/**
 * The reasoning core. Given an enriched candidate + its screening report,
 * Anton decides BUY / SKIP / HOLD with a natural-language rationale.
 *
 * Two paths, same output contract (TradeDecision):
 *   - DeepSeek path: real LLM call with a forced `submit_trade_decision` tool.
 *   - Fallback path: deterministic rule engine when no API key / on error.
 *
 * Either way we emit incremental reasoning steps via the onStep callback so
 * the dashboard's reasoning log streams live.
 */

import type {
  EnrichedCandidate,
  ScreeningReport,
  TradeAction,
  TradeDecision,
} from "@anton/shared-types";
import type { TradingConfig } from "@anton/config";
import { DeepSeekClient, type DeepSeekTool } from "./deepseek.js";

export interface ReasoningStep {
  thought: string;
  confidence?: number;
}

export interface DecideContext {
  candidate: EnrichedCandidate;
  screening: ScreeningReport;
  config: TradingConfig;
}

export interface DecideOptions {
  deepseek?: DeepSeekClient;
  model?: string;
  onStep?: (step: ReasoningStep) => void;
}

const DECISION_TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: "submit_trade_decision",
    description:
      "Submit the final trade decision for the given Solana meme token after analysis.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["BUY", "SKIP", "HOLD"],
          description: "BUY to enter, SKIP to pass, HOLD if already in position.",
        },
        size_sol: {
          type: "number",
          description: "Position size in SOL if action is BUY. Omit otherwise.",
        },
        confidence: { type: "number", description: "0..1 conviction." },
        reason: { type: "string", description: "Concise natural-language rationale." },
        stop_loss_pct: { type: "number" },
        take_profit_pct: { type: "number" },
      },
      required: ["action", "confidence", "reason"],
    },
  },
};

function buildSystemPrompt(cfg: TradingConfig): string {
  return [
    "You are Anton, an autonomous Solana meme-coin scalping agent.",
    "You receive one token candidate with market data and a safety screening report.",
    "Decide BUY, SKIP, or HOLD. Be ruthless about risk: reject honeypots, low liquidity, and live mint authority.",
    `Hard caps you must respect: size ${cfg.minSpendSol}-${cfg.maxSpendSol} SOL, max ${cfg.maxConcurrentPositions} positions,`,
    `default SL ${cfg.defaultStopLossPct}% / TP ${cfg.defaultTakeProfitPct}%.`,
    "Only BUY when the screening verdict is SAFE or CAUTION with strong momentum.",
    "Always call submit_trade_decision with a clear reason.",
  ].join(" ");
}

function buildUserPrompt(ctx: DecideContext): string {
  const m = ctx.candidate.market;
  const s = ctx.screening;
  return JSON.stringify(
    {
      token: { mint: ctx.candidate.mint, symbol: ctx.candidate.symbol, phase: ctx.candidate.phase },
      market: {
        priceUsd: m.priceUsd,
        liquidityUsd: m.liquidityUsd,
        volume5mUsd: m.volume5mUsd,
        pairAgeSec: m.pairAgeSec,
        priceChange5mPct: m.priceChange5mPct,
        momentum: m.momentum,
      },
      screening: {
        verdict: s.verdict,
        score: s.score,
        flags: s.flags,
        mintAuthorityRevoked: s.mintAuthorityRevoked,
        freezeAuthorityRevoked: s.freezeAuthorityRevoked,
      },
    },
    null,
    0,
  );
}

interface DecisionArgs {
  action?: TradeAction;
  size_sol?: number;
  confidence?: number;
  reason?: string;
  stop_loss_pct?: number;
  take_profit_pct?: number;
}

function clampSize(size: number | undefined, cfg: TradingConfig): number {
  const s = size ?? cfg.defaultSizeSol;
  return Math.max(cfg.minSpendSol, Math.min(cfg.maxSpendSol, s));
}

async function decideWithDeepSeek(
  ctx: DecideContext,
  client: DeepSeekClient,
  model: string,
  onStep?: (step: ReasoningStep) => void,
): Promise<TradeDecision> {
  onStep?.({ thought: `Engaging DeepSeek (${model}) on ${ctx.candidate.symbol ?? ctx.candidate.mint.slice(0, 6)}` });
  const msg = await client.chat({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(ctx.config) },
      { role: "user", content: buildUserPrompt(ctx) },
    ],
    tools: [DECISION_TOOL],
    // "auto" rather than a forced function: some OpenAI-compatible providers
    // reject a forced tool_choice with 400, but honor the tool under "auto".
    tool_choice: "auto",
    temperature: 0.4,
  });

  const call = msg.tool_calls?.[0];
  if (!call) throw new Error("deepseek: no tool call returned");
  const args = JSON.parse(call.function.arguments) as DecisionArgs;
  const action: TradeAction = args.action ?? "SKIP";
  onStep?.({ thought: args.reason ?? "decision returned", confidence: args.confidence });

  return {
    action,
    token: ctx.candidate.mint,
    symbol: ctx.candidate.symbol,
    size_sol: action === "BUY" ? clampSize(args.size_sol, ctx.config) : undefined,
    confidence: args.confidence ?? 0.5,
    reason: args.reason ?? "no rationale",
    stop_loss_pct: args.stop_loss_pct ?? ctx.config.defaultStopLossPct,
    take_profit_pct: args.take_profit_pct ?? ctx.config.defaultTakeProfitPct,
    risk_flags: ctx.screening.flags,
  };
}

function decideWithRules(
  ctx: DecideContext,
  onStep?: (step: ReasoningStep) => void,
): TradeDecision {
  const { candidate, screening, config } = ctx;
  const m = candidate.market;
  const sym = candidate.symbol ?? candidate.mint.slice(0, 6);

  onStep?.({ thought: `Rule engine evaluating ${sym} · verdict ${screening.verdict} · score ${screening.score}` });

  let action: TradeAction = "SKIP";
  let confidence = 0.4;
  let reason: string;

  const momentum = m.momentum ?? 0;
  const liq = m.liquidityUsd ?? 0;

  if (screening.verdict === "REJECT") {
    reason = `Rejected by screening (${screening.flags.slice(0, 3).join(", ")}); risk asymmetry unfavorable`;
    confidence = 0.82;
  } else if (liq < config.minLiquidityUsd) {
    reason = `Liquidity $${Math.round(liq).toLocaleString()} below floor $${config.minLiquidityUsd.toLocaleString()}; skip`;
    confidence = 0.7;
  } else if (screening.verdict === "SAFE" && momentum > 0.05) {
    action = "BUY";
    confidence = Math.min(0.55 + momentum, 0.92);
    reason = `SAFE + momentum +${(momentum * 100).toFixed(1)}% with liq $${Math.round(liq).toLocaleString()}; entering`;
    onStep?.({ thought: `Momentum confirmed, within size band [${config.minSpendSol}, ${config.maxSpendSol}] SOL`, confidence });
  } else if (screening.verdict === "CAUTION" && momentum > 0.15) {
    action = "BUY";
    confidence = 0.58;
    reason = `CAUTION but strong momentum +${(momentum * 100).toFixed(1)}%; small entry`;
  } else {
    reason = `No edge: verdict ${screening.verdict}, momentum ${(momentum * 100).toFixed(1)}%; pass`;
    confidence = 0.5;
  }

  return {
    action,
    token: candidate.mint,
    symbol: candidate.symbol,
    size_sol: action === "BUY" ? clampSize(undefined, config) : undefined,
    confidence,
    reason,
    stop_loss_pct: config.defaultStopLossPct,
    take_profit_pct: config.defaultTakeProfitPct,
    risk_flags: screening.flags,
  };
}

/**
 * Decide a trade. Uses DeepSeek when a client is provided; on any error (or
 * when no client is given) falls back to the deterministic rule engine.
 */
export async function decide(
  ctx: DecideContext,
  opts: DecideOptions = {},
): Promise<TradeDecision> {
  if (opts.deepseek) {
    try {
      return await decideWithDeepSeek(ctx, opts.deepseek, opts.model ?? "deepseek-v4-flash", opts.onStep);
    } catch (err) {
      opts.onStep?.({ thought: `DeepSeek unavailable (${String(err).slice(0, 60)}), using rule engine` });
    }
  }
  return decideWithRules(ctx, opts.onStep);
}
