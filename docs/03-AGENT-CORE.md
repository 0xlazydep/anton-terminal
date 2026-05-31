# 03 — Agent Core (DeepSeek Brain)

The reasoning engine. DeepSeek V4 decides every action and produces a rationale. Wrapped in a Mastra durable workflow, scheduled by BullMQ.

---

## 1. DeepSeek Configuration

**Base URL:** `https://api.deepseek.com` (OpenAI-compatible). Beta (strict tools): `https://api.deepseek.com/beta`.

**Models:**
| Model | Use | Context | Notes |
|---|---|---|---|
| `deepseek-v4-flash` | Default trading loop | 1M | Fast, cheap ($0.14/M in, $0.28/M out), tool-calling, thinking optional |
| `deepseek-v4-pro` | Deep/anomaly analysis | 1M | Frontier reasoning, escalation only |

> Legacy `deepseek-chat`/`deepseek-reasoner` deprecate 2026-07-24. Use V4 + `thinking` param.

```typescript
// packages/agent/src/llm.ts
import OpenAI from 'openai';

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com',
  timeout: 120_000,
  maxRetries: 3,
});

// thinking is a request param (not a model). For TS, send as extra field.
// reasoning_content MUST be round-tripped within a tool-calling turn (else HTTP 400).
```

**Cost note:** ~$0.30 per 1,000 cycles on v4-flash with cached system prompt. Place static system prompt FIRST (auto cache-hit = 50× cheaper).

---

## 2. Decision Schema (Tool-Call Structured Output)

Anton uses a **terminal tool** `submit_trade_decision` (strict mode) — more reliable than JSON mode for enforcing schema.

```typescript
// packages/agent/src/tools/decision.ts
export const SUBMIT_DECISION = {
  type: 'function',
  function: {
    name: 'submit_trade_decision',
    strict: true,
    description: 'Submit final trade decision after analysis. ALWAYS include reason.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['BUY','SELL','HOLD','SKIP','SET_SL','SET_TP'] },
        token:  { type: 'string', description: 'mint address' },
        symbol: { type: 'string' },
        size_sol: { type: 'number', minimum: 0 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string', maxLength: 400, description: 'WHY this decision' },
        stop_loss_pct: { type: ['number','null'] },
        take_profit_pct: { type: ['number','null'] },
        risk_flags: { type: 'array', items: { type: 'string' } },
      },
      required: ['action','token','confidence','reason'],
      additionalProperties: false,
    },
  },
};
```

Every decision → `DecisionRecord` (persisted + streamed). The `reason` field satisfies the "explain every entry/SL/hold/skip" requirement.

---

## 3. Tool Registry (What Anton Can Do)

DeepSeek calls these tools; the agent executes them (DeepSeek never executes directly).

| Tool | Purpose | Reads/Writes |
|---|---|---|
| `get_token_market_data(mint)` | Price, liq, volume, momentum, OHLCV | read |
| `get_screening_report(mint)` | Safety pipeline result | read |
| `get_smart_wallet_context(mint)` | Which smart wallets hold/entered/exited | read |
| `recall_lessons(context)` | Semantic search of past lessons | read |
| `get_open_positions()` | Current portfolio + PnL | read |
| `get_social_signal(mint)` | Twitter velocity, mindshare | read |
| `submit_trade_decision(...)` | **Terminal** — finalize decision | write (DB+stream) |

The agent loop appends tool results and re-invokes until `submit_trade_decision` is called.

---

## 4. System Prompt (Identity + Rules)

```typescript
// packages/agent/src/system-prompt.ts — CACHED across all cycles
export function buildSystemPrompt(id: AgentIdentity, op: UserProfile): string {
  return `You are ${id.name}, an autonomous Solana meme coin trading agent.
You were created ${new Date(id.createdAt).toISOString()}. Your operator is ${op.name}.
You remember ${op.name} and address them by name when relevant.

PERSONALITY: ${id.personality.tone}. Risk profile: ${id.personality.riskTolerance}.
You scalp fast: small positions (~${id.personality.maxPositionSizeSol} SOL), many entries.

IMMUTABLE RULES (NEVER violate):
${id.immutableRules.map(r => '- ' + r).join('\n')}

DECISION DISCIPLINE:
- You MUST call submit_trade_decision exactly once per analysis.
- You MUST give a concrete reason for EVERY action (BUY/SELL/HOLD/SKIP/SL/TP).
- Default to SKIP/HOLD when uncertain. Unknown safety = SKIP.
- Learn from PAST LESSONS injected below. Do not repeat past mistakes.
- You imitate proven smart-money wallets but verify with your own analysis.`;
}
```

Identity & operator are loaded from DB at startup (see `05-MEMORY.md`), NOT vector memory.

---

## 5. ReAct Loop (Mastra Workflow Step)

```typescript
// packages/agent/src/loop.ts
export async function decide(candidate: EnrichedCandidate): Promise<DecisionRecord> {
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },                 // cached
    { role: 'system', content: await injectLessons(candidate) },// relevant lessons
    { role: 'user', content: renderContext(candidate) },        // market + smart-wallet + social
  ];

  for (let turn = 0; turn < 8; turn++) {
    const res = await deepseek.chat.completions.create({
      model: pickModel(candidate),         // flash default; pro if volatile/low-confidence
      messages, tools: TOOLS,
      // thinking enabled for pro escalation only
    });
    const msg = res.choices[0].message;
    messages.push({                         // preserve reasoning_content for tool turns
      role: 'assistant', content: msg.content,
      reasoning_content: (msg as any).reasoning_content,
      tool_calls: msg.tool_calls,
    });
    if (!msg.tool_calls?.length) continue;

    for (const tc of msg.tool_calls) {
      if (tc.function.name === 'submit_trade_decision') {
        const decision = JSON.parse(tc.function.arguments);
        return persistAndStream(decision, candidate, messages); // DONE
      }
      const result = await TOOL_EXECUTORS[tc.function.name](JSON.parse(tc.function.arguments));
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  // Fallback: no decision → SKIP with reason
  return persistAndStream({ action: 'SKIP', reason: 'max turns, defaulting safe', confidence: 0 }, candidate, messages);
}
```

**Two-tier model selection:** start with `v4-flash` non-thinking. Escalate to `v4-pro` thinking when confidence < 0.7 or market volatility high — re-decide. Saves cost while keeping depth where it matters.

**Resilience:** semaphore (cap 8–16 concurrent), exponential backoff with jitter on 429/503, circuit-breaker at 30% failure over 60s → default HOLD. ~2% tool-call miss rate → single retry.

---

## 6. Scheduling (BullMQ)

```typescript
// packages/scheduler/src/queues.ts
const trading = new Queue('anton:trading', { connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200 }, removeOnFail: { count: 500 } } });

// Recurring cycle (also triggered by ws events for hot candidates)
await trading.add('cycle', {}, { repeat: { every: 30_000 }, jobId: 'anton:cycle' });
```

**Queues:** `anton:candidates` (ingest), `anton:screening`, `anton:decision`, `anton:execution`, `anton:reflection`, `anton:monitor` (SL/TP watchers). Flow producer chains analyze → decide → execute → reflect.

**Event-driven fast path:** a smart-wallet BUY or a hot new launch can bypass the 30s timer and enqueue a decision job immediately (latency matters for scalps).

---

## 7. What Gets Persisted Per Decision

```typescript
interface DecisionRecord {
  id: string; ts: number;
  mint: string; symbol?: string;
  action: 'BUY'|'SELL'|'HOLD'|'SKIP'|'SET_SL'|'SET_TP';
  sizeSol?: number; confidence: number;
  reason: string;                       // the rationale (required)
  stopLossPct?: number; takeProfitPct?: number;
  riskFlags: string[];
  modelUsed: 'flash'|'pro';
  inputContextHash: string;             // for audit
  smartWalletsInToken: string[];
  screeningScore?: number;
  mode: 'dry-run'|'live';
  reasoningTrace?: string;              // optional thinking content (pro)
}
```

Streamed to dashboard as `reasoning_step` + `entry_decision` events. Stored in `decisions` table (see `08-DATA-MODEL.md`).
