import { DeepSeekClient } from "@anton/agent";
import {
  insertLesson,
  upsertPatternStat,
  type Database,
} from "@anton/data";

export interface ClosedTradeContext {
  symbol?: string;
  mint: string;
  pnlPct: number;
  pnlSol: number;
  entryPriceUsd: number;
  exitPriceUsd: number;
  sizeSol: number;
  slPct: number;
  tpPct: number;
  holdSec: number;
  reason: string;
  source?: string;
  phase?: string;
  screeningVerdict?: string;
  marketCapUsd?: number;
  liquidityUsd?: number;
}

async function reflectWithLLM(
  trade: ClosedTradeContext,
  deepseek: DeepSeekClient,
): Promise<string> {
  const isWin = trade.pnlSol > 0;
  const prompt = [
    "Analyze this closed trade and extract ONE concise, actionable lesson.",
    "Format: 1-2 sentences maximum. Be specific — mention what pattern to watch for or what threshold to adjust.",
    isWin
      ? "This was a WINNING trade. What made it work? What pattern should we repeat?"
      : "This was a LOSING trade. What went wrong? What should we avoid or change?",
    "",
    JSON.stringify({
      symbol: trade.symbol,
      pnl: `${trade.pnlPct.toFixed(1)}% (${trade.pnlSol.toFixed(4)} SOL)`,
      entry: `$${trade.entryPriceUsd}`,
      exit: `$${trade.exitPriceUsd}`,
      size: `${trade.sizeSol} SOL`,
      stopLoss: `${trade.slPct}%`,
      takeProfit: `${trade.tpPct}%`,
      holdTime: `${Math.floor(trade.holdSec / 60)}m ${trade.holdSec % 60}s`,
      closeReason: trade.reason,
      source: trade.source ?? "unknown",
      screeningVerdict: trade.screeningVerdict ?? "unknown",
      marketCapUsd: trade.marketCapUsd,
      liquidityUsd: trade.liquidityUsd,
    }, null, 0),
  ].join("\n");

  try {
    const msg = await deepseek.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: "You are a trading analyst extracting lessons from closed trades. Output ONE complete, actionable lesson. Start directly with the lesson — no labels, no bullets, no JSON. Must be a full grammatical sentence that ends with a period. Maximum 2 sentences.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    return msg.content?.trim() ?? `${isWin ? "Winning" : "Losing"} trade on ${trade.symbol ?? trade.mint.slice(0, 8)}`;
  } catch {
    return `${isWin ? "Won" : "Lost"} ${trade.pnlPct.toFixed(1)}% on ${trade.symbol ?? "token"} — ${trade.reason}`;
  }
}

function derivePatternKeys(trade: ClosedTradeContext): Array<{ category: string; key: string }> {
  const keys: Array<{ category: string; key: string }> = [];

  if (trade.source) keys.push({ category: "source", key: trade.source });
  if (trade.phase) keys.push({ category: "phase", key: trade.phase });
  if (trade.screeningVerdict) keys.push({ category: "verdict", key: trade.screeningVerdict });

  if (trade.marketCapUsd !== undefined) {
    const mc = trade.marketCapUsd;
    if (mc < 50_000) keys.push({ category: "mc_range", key: "micro" });
    else if (mc < 200_000) keys.push({ category: "mc_range", key: "small" });
    else if (mc < 1_000_000) keys.push({ category: "mc_range", key: "mid" });
    else keys.push({ category: "mc_range", key: "large" });
  }

  if (trade.liquidityUsd !== undefined) {
    const liq = trade.liquidityUsd;
    if (liq < 3_000) keys.push({ category: "liquidity", key: "low" });
    else if (liq < 15_000) keys.push({ category: "liquidity", key: "medium" });
    else keys.push({ category: "liquidity", key: "high" });
  }

  if (trade.holdSec < 300) keys.push({ category: "hold_time", key: "fast" });
  else if (trade.holdSec < 1800) keys.push({ category: "hold_time", key: "medium" });
  else keys.push({ category: "hold_time", key: "slow" });

  return keys;
}

export async function reflectOnClose(
  trade: ClosedTradeContext,
  deepseek: DeepSeekClient,
  db?: Database,
): Promise<void> {
  if (!db) return;

  const isWin = trade.pnlSol > 0;
  const lesson = await reflectWithLLM(trade, deepseek);

  // Store lesson
  await insertLesson(db, {
    category: isWin ? "pattern" : "entry_mistake",
    summary: lesson,
    severity: isWin ? "note" : (Math.abs(trade.pnlPct) > 15 ? "critical" : "important"),
    source: trade.reason,
    tradeIds: [],
  }).catch(() => {});

  // Update pattern stats for each derived key
  const patterns = derivePatternKeys(trade);
  for (const p of patterns) {
    await upsertPatternStat(db, {
      category: p.category,
      key: p.key,
      isWin,
      pnlSol: trade.pnlSol,
      pnlPct: trade.pnlPct,
    }).catch(() => {});
  }
}
