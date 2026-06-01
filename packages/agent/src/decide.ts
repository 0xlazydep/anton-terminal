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
  /** Open positions for portfolio awareness (symbol, PnL%, age, size). */
  openPositions?: Array<{ symbol?: string; pnlPct: number; sizeSol: number; openedAt: number }>;
  /** Remaining SOL budget for risk-adjusted position sizing. */
  remainingBudgetSol?: number;
  /** Today's realized PnL (for daily loss enforcement context). */
  realizedPnlSol?: number;
  /** Recent lessons from past trades to inject into prompt. */
  recentLessons?: string[];
  /** Pattern stats summary string to inject into prompt. */
  patternStatsSummary?: string;
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
      "Submit the final trade decision for the given Solana meme token after thorough analysis of all provided signals.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["BUY", "SKIP", "HOLD", "EXIT"],
          description: "BUY to enter a new position, SKIP to pass, HOLD to keep watching, EXIT to close an existing position.",
        },
        size_sol: {
          type: "number",
          description: "Position size in SOL. Required for BUY. Adjust for conviction: low conviction = minSpendSol, high conviction = maxSpendSol.",
        },
        confidence: { type: "number", description: "0..1 conviction strength." },
        reason: { type: "string", description: "Concise rationale citing specific data points that drove this decision." },
        stop_loss_pct: {
          type: "number",
          description: "REQUIRED for BUY. Dynamic stop loss % based on token volatility and market cap. Meme coins: 8-20%.",
        },
        take_profit_pct: {
          type: "number",
          description: "REQUIRED for BUY. Dynamic take profit %. Micro-caps: 20-35%, mid-caps: 30-60%.",
        },
        exit_position_id: {
          type: "string",
          description: "ID of the position to exit. Only set when action=EXIT.",
        },
      },
      required: ["action", "confidence", "reason", "stop_loss_pct", "take_profit_pct"],
    },
  },
};

function buildSystemPrompt(cfg: TradingConfig, ctx?: DecideContext): string {
  return [
    "You are Anton, an autonomous Solana meme-coin scalping agent. Your goal is asymmetric risk-reward on micro-cap tokens.",
    "",
    "=== DECISION FRAMEWORK ===",
    "Analyze the token candidate using every data point provided. Then call submit_trade_decision.",
    "",
    "=== SIGNAL PRIORITY ===",
    "1. MOMENTUM & VOLUME — Strong positive 5m price change with real volume is the PRIMARY entry signal. Weak momentum on SAFE tokens = wait. No volume = no trade.",
    "2. LIQUIDITY & MARKET CAP — Liquidity < $3,000 and MC < $50K = micro-cap gamble. Only enter with very strong momentum (>15% 5m). Liquidity > $10K + MC > $100K = safer, standard entry criteria apply.",
    "3. HOLDER CONCENTRATION — Top 10 holders > 60% = high dump risk. Treat as CAUTION regardless of screening verdict.",
    "4. SCREENING — SAFE = no structural red flags (mint/freeze revoked, no rugcheck flags). CAUTION = elevated risk, only enter with strong momentum + good liquidity.",
    "5. SMART WALLETS (BONUS) — If smart wallet data IS available and shows entries, this is a strong bullish confirm. If the array is EMPTY, it means data is unavailable — do NOT treat this as a negative signal. Trade on the other signals.",
    "",
    "=== STOP LOSS / TAKE PROFIT RULES (DYNAMIC, PER TOKEN) ===",
    "NEVER use default values blindly. Set SL and TP based on the token's actual characteristics:",
    "- Micro-cap (MC < $100K): SL 8-12%, TP 20-35% — these move fast and rug fast.",
    "- Small-cap (MC $100K-$500K): SL 10-15%, TP 25-45%.",
    "- Mid-cap+ (MC > $500K): SL 12-18%, TP 30-60%.",
    "- High volatility (5m change > 20%): wider SL (15-20%) to avoid noise. Tighter TP (20-30%) to capture the pump before it dumps.",
    "- Low liquidity (< $5K): wider SL (15-20%) for slippage tolerance; smaller TP (20-30%).",
    "",
    "=== PORTFOLIO AWARENESS ===",
    "If openPositions are provided, consider your current exposure:",
    "- At or near max positions → be more selective, raise the bar for entry.",
    "- Several positions deep in loss → reduce size, tighten SL.",
    "- Multiple positions in same sector/pattern → avoid correlation risk.",
    "",
    "=== BUY CHECKLIST (at least 3 must pass) ===",
    "☐ Screening: SAFE, or CAUTION with strong momentum (>15% 5m).",
    "☐ Momentum: positive 5m change AND volume5m > $500.",
    "☐ Liquidity: > $3,000 for standard entry, or > $1,000 with strong momentum.",
    "☐ Holders: top 10 < 60%.",
    "☐ Budget: size within ${cfg.minSpendSol}-${cfg.maxSpendSol} SOL, conviction-adjusted.",
    "☐ Capacity: remaining position slots available (max ${cfg.maxConcurrentPositions}).",
    "",
    "=== WHEN TO SKIP ===",
    "- Screening REJECT → always skip, no exceptions.",
    "- No momentum or negative momentum.",
    "- Liquidity + volume too low to exit without severe slippage (sub-$1K volume on sub-$5K MC).",
    "- You are uncertain → SKIP. Missing a trade costs nothing. A bad entry costs capital.",
    "",
    ctx?.patternStatsSummary
      ? [`=== PATTERN STATISTICS (from past trades) ===`, ctx.patternStatsSummary, ""].join("\n")
      : "",
    ctx?.recentLessons && ctx.recentLessons.length > 0
      ? [
          "=== RECENT LESSONS ===",
          ...ctx.recentLessons.map((l, i) => `${i + 1}. ${l}`),
          "",
        ].join("\n")
      : "",
    "Always call submit_trade_decision with action, confidence, reason, stop_loss_pct, take_profit_pct.",
  ].join("\n");
}

function buildUserPrompt(ctx: DecideContext): string {
  const m = ctx.candidate.market;
  const s = ctx.screening;
  const sig = ctx.candidate.signals;

  return JSON.stringify(
    {
      token: {
        mint: ctx.candidate.mint,
        symbol: ctx.candidate.symbol,
        phase: ctx.candidate.phase,
        source: ctx.candidate.source,
      },
      market: {
        priceUsd: m.priceUsd,
        liquidityUsd: m.liquidityUsd,
        volume5mUsd: m.volume5mUsd,
        volume24hUsd: m.volume24hUsd,
        marketCapUsd: m.marketCapUsd,
        fdvUsd: m.fdvUsd,
        pairAgeSec: m.pairAgeSec,
        priceChange5mPct: m.priceChange5mPct,
        priceChange1hPct: m.priceChange1hPct,
        momentum: m.momentum,
        holderCount: m.holderCount,
      },
      screening: {
        verdict: s.verdict,
        score: s.score,
        flags: s.flags,
        mintAuthorityRevoked: s.mintAuthorityRevoked,
        freezeAuthorityRevoked: s.freezeAuthorityRevoked,
        top10HolderPct: s.top10Pct,
        liquidityUsd: s.liquidityUsd,
        pairAgeSec: s.pairAgeSec,
      },
      signals: {
        smartWallets: sig.smartWallets ?? [],
        socialMentions: sig.socialMentions,
      },
      portfolio: ctx.openPositions
        ? {
            openPositions: ctx.openPositions.map((p) => ({
              symbol: p.symbol,
              pnlPct: Math.round(p.pnlPct * 100) / 100,
              sizeSol: p.sizeSol,
              ageSec: Math.floor((Date.now() - p.openedAt) / 1000),
            })),
            openCount: ctx.openPositions.length,
            maxPositions: ctx.config.maxConcurrentPositions,
            remainingSlots: ctx.config.maxConcurrentPositions - ctx.openPositions.length,
          }
        : undefined,
      budget: ctx.remainingBudgetSol !== undefined
        ? { remainingSol: ctx.remainingBudgetSol }
        : undefined,
      constraints: {
        minSpendSol: ctx.config.minSpendSol,
        maxSpendSol: ctx.config.maxSpendSol,
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
  exit_position_id?: string;
}

function clampSize(
  size: number | undefined,
  cfg: TradingConfig,
  conviction: number,
  remainingBudgetSol?: number,
): number {
  const raw = size ?? cfg.defaultSizeSol;
  const convictionMul = Math.max(0.3, Math.min(1.0, conviction));
  const baseSize = cfg.minSpendSol + (cfg.maxSpendSol - cfg.minSpendSol) * convictionMul;
  let adjusted = Math.max(cfg.minSpendSol, Math.min(cfg.maxSpendSol, isNaN(raw) ? baseSize : raw * convictionMul));

  if (remainingBudgetSol !== undefined && remainingBudgetSol > 0) {
    const budgetCap = remainingBudgetSol * 0.25;
    adjusted = Math.min(adjusted, budgetCap);
  }

  return Math.max(cfg.minSpendSol, Math.min(cfg.maxSpendSol, Math.round(adjusted * 1000) / 1000));
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
      { role: "system", content: buildSystemPrompt(ctx.config, ctx) },
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
    size_sol: action === "BUY" ? clampSize(args.size_sol, ctx.config, args.confidence ?? 0.5, ctx.remainingBudgetSol) : undefined,
    confidence: args.confidence ?? 0.5,
    reason: args.reason ?? "no rationale",
    stop_loss_pct: args.stop_loss_pct ?? ctx.config.defaultStopLossPct,
    take_profit_pct: args.take_profit_pct ?? ctx.config.defaultTakeProfitPct,
    risk_flags: ctx.screening.flags,
    exit_position_id: args.exit_position_id,
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
  let slPct = config.defaultStopLossPct;
  let tpPct = config.defaultTakeProfitPct;

  const momentum = m.momentum ?? 0;
  const liq = m.liquidityUsd ?? 0;
  const mc = m.marketCapUsd ?? 0;

  if (screening.verdict === "REJECT") {
    reason = `Rejected by screening (${screening.flags.slice(0, 3).join(", ")}); risk asymmetry unfavorable`;
    confidence = 0.85;
  } else if (liq < config.minLiquidityUsd) {
    reason = `Liquidity $${Math.round(liq).toLocaleString()} below floor $${config.minLiquidityUsd.toLocaleString()}; skip`;
    confidence = 0.7;
  } else if (screening.verdict === "SAFE" && momentum > 0.08) {
    action = "BUY";
    confidence = Math.min(0.55 + momentum, 0.85);
    reason = `SAFE + momentum +${(momentum * 100).toFixed(1)}% liq $${Math.round(liq).toLocaleString()}`;
    slPct = mc < 100_000 ? -10 : mc < 500_000 ? -12 : -15;
    tpPct = mc < 100_000 ? 25 : mc < 500_000 ? 35 : 45;
  } else if (screening.verdict === "CAUTION" && momentum > 0.20) {
    action = "BUY";
    confidence = 0.55;
    reason = `CAUTION but very strong momentum +${(momentum * 100).toFixed(1)}%`;
    slPct = -8;
    tpPct = 20;
  } else {
    reason = `No edge: verdict ${screening.verdict}, momentum ${(momentum * 100).toFixed(1)}%; pass`;
    confidence = 0.5;
  }

  return {
    action,
    token: candidate.mint,
    symbol: candidate.symbol,
    size_sol: action === "BUY" ? clampSize(undefined, config, confidence, ctx.remainingBudgetSol) : undefined,
    confidence,
    reason,
    stop_loss_pct: slPct,
    take_profit_pct: tpPct,
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

const EXIT_TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: "submit_exit_decision",
    description: "Evaluate an open position and decide whether to HOLD or EXIT based on current market conditions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["HOLD", "EXIT"],
          description: "HOLD to keep the position open, EXIT to close it now.",
        },
        confidence: { type: "number", description: "0..1 conviction." },
        reason: { type: "string", description: "Concise rationale referencing specific data." },
      },
      required: ["action", "confidence", "reason"],
    },
  },
};

function buildExitSystemPrompt(): string {
  return [
    "You are Anton evaluating an OPEN position. Your job is to decide whether to HOLD or EXIT.",
    "",
    "=== EXIT CRITERIA (exit when ANY of these are true) ===",
    "1. Momentum has reversed — price was climbing but 5m change is now negative.",
    "2. Profit is fading — you're up but momentum is dying; capture gains before reversal.",
    "3. Loss is accelerating — already down and momentum continues negative.",
    "4. Time decay — position is old (15+ min) with no meaningful movement (< 3% either way).",
    "",
    "=== HOLD CRITERIA (hold when ALL of these are true) ===",
    "1. Momentum is still positive or neutral.",
    "2. You are in profit and the trend is intact.",
    "3. You are in loss but within tolerance AND momentum hasn't turned sharply negative.",
    "",
    "=== RULES ===",
    "- When in doubt, EXIT. Protecting capital > missing a recovery.",
    "- A small profit taken is better than a profit that becomes a loss.",
    "- A 10% loss that could become 30% is an EXIT. A 10% loss that's stabilizing is a HOLD.",
    "- Always call submit_exit_decision.",
  ].join("\n");
}

function buildExitUserPrompt(
  pos: { symbol?: string; pnlPct: number; entryPriceUsd: number; currentPriceUsd: number; sizeSol: number; slPct: number; tpPct: number; ageSec: number },
  market: { priceChange5mPct?: number; momentum?: number; volume5mUsd?: number },
): string {
  return JSON.stringify({
    position: {
      symbol: pos.symbol,
      pnlPct: Math.round(pos.pnlPct * 100) / 100,
      entryPriceUsd: pos.entryPriceUsd,
      currentPriceUsd: pos.currentPriceUsd,
      sizeSol: pos.sizeSol,
      slPct: pos.slPct,
      tpPct: pos.tpPct,
      ageSec: Math.floor(pos.ageSec),
      ageMin: Math.floor(pos.ageSec / 60),
    },
    market: {
      priceChange5mPct: market.priceChange5mPct,
      momentum: market.momentum,
      volume5mUsd: market.volume5mUsd,
    },
  }, null, 0);
}

export interface ExitDecision {
  action: "HOLD" | "EXIT";
  reason: string;
  confidence: number;
}

export async function decideExit(
  position: { symbol?: string; mint: string; pnlPct: number; entryPriceUsd: number; currentPriceUsd: number; sizeSol: number; slPct: number; tpPct: number; ageSec: number },
  market: { priceChange5mPct?: number; momentum?: number; volume5mUsd?: number },
  opts: DecideOptions = {},
): Promise<ExitDecision> {
  if (opts.deepseek) {
    try {
      const msg = await opts.deepseek.chat({
        model: opts.model ?? "deepseek-v4-flash",
        messages: [
          { role: "system", content: buildExitSystemPrompt() },
          { role: "user", content: buildExitUserPrompt(position, market) },
        ],
        tools: [EXIT_TOOL],
        tool_choice: "auto",
        temperature: 0.3,
      });

      const call = msg.tool_calls?.[0];
      if (call) {
        const args = JSON.parse(call.function.arguments) as { action?: string; confidence?: number; reason?: string };
        opts.onStep?.({ thought: args.reason ?? "exit evaluated", confidence: args.confidence });
        return {
          action: (args.action === "EXIT" ? "EXIT" : "HOLD") as "HOLD" | "EXIT",
          reason: args.reason ?? "no rationale",
          confidence: args.confidence ?? 0.5,
        };
      }
    } catch {
      opts.onStep?.({ thought: "Exit eval failed, using rule-based fallback" });
    }
  }

  // Rule-based exit fallback
  const { pnlPct, ageSec, slPct } = position;
  const momentum = market.momentum ?? 0;

  if (pnlPct <= -(slPct * 0.75)) {
    return { action: "EXIT", reason: `Approaching SL: ${pnlPct.toFixed(1)}% vs ${slPct}%`, confidence: 0.8 };
  }
  if (pnlPct > 0 && momentum < -0.03) {
    return { action: "EXIT", reason: `Profit ${pnlPct.toFixed(1)}% but momentum reversed ${momentum.toFixed(2)}`, confidence: 0.7 };
  }
  if (pnlPct < -5 && momentum < -0.02) {
    return { action: "EXIT", reason: `Loss ${pnlPct.toFixed(1)}% accelerating with momentum ${momentum.toFixed(2)}`, confidence: 0.75 };
  }
  if (ageSec > 1800 && Math.abs(pnlPct) < 3) {
    return { action: "EXIT", reason: `Stale position: ${Math.floor(ageSec / 60)}min with no movement`, confidence: 0.65 };
  }
  return { action: "HOLD", reason: `PnL ${pnlPct.toFixed(1)}%, momentum ${momentum.toFixed(2)} — holding`, confidence: 0.6 };
}
