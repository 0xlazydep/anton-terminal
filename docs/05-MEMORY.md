# 05 — Memory (Lessons, Identity, Operator)

Anton remembers. Three memory types: **episodic lessons** (learned from trades), **identity** (who Anton is), **operator memory** (who calls Anton). Episodic memory uses pgvector + a Reflexion loop.

---

## 1. Memory Types

| Type | Store | Mutable by | Purpose |
|---|---|---|---|
| Identity | Postgres `agent_identity` (JSON) | Operator only | Name "Anton", personality, immutable rules |
| Operator | Postgres `user_profile` + Mem0/pgvector | Operator + agent (facts) | Remembers operator, preferences, taught lessons |
| Episodic lessons | Postgres `lessons` + pgvector embeddings | Agent (Reflexion) | "What I learned from past trades" |
| Conversation | Mastra memory | Agent | Operator chat history |

> **Abstraction first:** all memory behind `IMemoryClient` so we can swap pgvector ↔ Mem0 ↔ Zep without rewrites.

```typescript
// packages/memory/src/client.ts
export interface IMemoryClient {
  storeLesson(ep: TradeEpisode, lesson: Lesson): Promise<void>;
  retrieveLessons(ctx: MarketContext, k?: number): Promise<Lesson[]>;
  retireLesson(id: string, reason: string): Promise<void>;
  storeUserFact(f: UserFact): Promise<void>;
  getUserProfile(userId: string): Promise<UserProfile>;
  getIdentity(): Promise<AgentIdentity>;
}
```

**Default impl:** `PgVectorMemoryClient` (one Postgres). Upgrade path: Mem0 (managed facts) or Zep (temporal graph) if needed.

---

## 2. Identity ("Anton")

Structured state, read at startup, edited ONLY by operator.

```typescript
interface AgentIdentity {
  name: 'Anton';
  version: string;
  createdAt: number;
  personality: {
    tone: string;                 // "Analytical, self-aware, decisive scalper"
    riskTolerance: 'LOW'|'MEDIUM'|'HIGH'|'DEGEN';
    preferredMarkets: string[];
    maxPositionSizeSol: number;   // 0.1
    maxDailyLossSol: number;
    defaultStopLossPct: number;
    defaultTakeProfitPct: number;
  };
  immutableRules: string[];       // hard constraints, never agent-edited
}
```

Example `immutableRules`:
- "NEVER spend more than maxPositionSizeSol per position."
- "NEVER enter a token failing the safety screen."
- "ALWAYS set a stop-loss on every BUY."
- "NEVER exceed maxDailyLossSol — halt trading for the day if hit."
- "NEVER trade a token younger than the configured minimum age."

Injected into the system prompt every cycle → Anton always "knows who it is."

---

## 3. Operator Memory ("remembers who calls it")

```typescript
interface UserProfile {
  userId: string; name: string;            // operator's name
  preferences: {
    notificationChannel: 'discord'|'telegram'|'console';
    approvalRequired: boolean;             // human-in-loop above threshold
    approvalThresholdSol: number;
    riskBoundaries: { maxDailyLoss: number; maxPositionSize: number };
  };
  interaction: { lastSeen: number; sessions: number; commands: string[] };
  taughtLessons: { id: string; content: string; ts: number; category: string }[];
}
```

The operator can talk to Anton ("you're too aggressive on new launches") → stored as a `UserFact` (tagged `source:'user'`) in the same episodic store, and surfaced alongside trade lessons. Anton greets the operator by name and recalls preferences.

---

## 4. Episodic Lessons + Reflexion Loop

Based on Reflexion (verbal self-reinforcement). On every CLOSED position:

```
ACTOR (decision) → ENVIRONMENT (PnL outcome) → SELF-REFLECT (LLM) → LESSON → STORE → INJECT next time
```

```typescript
interface TradeEpisode {
  id: string; ts: number;
  token: string; symbol: string;
  marketSnapshot: MarketContext;
  decision: { action: string; sizeSol: number; reason: string; confidence: number };
  smartWalletBasis?: SmartWalletContext;
  outcome: {
    pnlSol: number; pnlPct: number; maxDrawdownPct: number; slippageBps: number;
    holdSeconds: number;
    category: 'WIN_BIG'|'WIN_SMALL'|'BREAKEVEN'|'LOSS_SMALL'|'LOSS_BIG';
  };
}

interface Lesson {
  id: string; createdAt: number;
  category: string;            // 'entry_timing' | 'sizing' | 'exit' | 'screening' | 'smart_wallet'
  summary: string;             // actionable, root-cause
  severity: 'critical'|'important'|'note';
  embedding: number[];         // for semantic recall
  tradeIds: string[];
  retired?: boolean;
}
```

```typescript
// packages/memory/src/reflection.ts
export async function reflect(ep: TradeEpisode, mem: IMemoryClient): Promise<Lesson> {
  const prompt = `You are Anton's self-critique module. Analyze this trade and produce
ONE specific, actionable lesson with root cause.
TRADE: ${ep.decision.action} ${ep.symbol} ${ep.decision.sizeSol} SOL — reason was "${ep.decision.reason}"
OUTCOME: PnL ${ep.outcome.pnlPct}% (${ep.outcome.category}), maxDD ${ep.outcome.maxDrawdownPct}%, held ${ep.outcome.holdSeconds}s
CONTEXT: liq ${ep.marketSnapshot.liquidityUsd}, momentum ${ep.marketSnapshot.momentum}
${ep.smartWalletBasis ? 'SMART-WALLET BASIS was used.' : ''}
If WIN: what was right and is it repeatable? If LOSS: root cause and the rule to add.
Return JSON {category, summary, severity}.`;
  const out = await deepseek.chat.completions.create({
    model: 'deepseek-v4-flash', messages: [{ role:'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const lesson = toLesson(out, ep);
  await mem.storeLesson(ep, lesson);     // embeds + inserts
  return lesson;
}
```

**Retrieval-Augmented Reflexion (RAR):** when reflecting on token X, also retrieve Anton's best win and worst loss on similar tokens for contrastive context → richer lessons.

---

## 5. Injecting Lessons Into Decisions

```typescript
// packages/memory/src/inject.ts
export async function injectLessons(ctx: MarketContext, mem: IMemoryClient): Promise<string> {
  const lessons = (await mem.retrieveLessons(ctx, 8))
    .filter(l => !l.retired)
    .sort((a,b) => rank(b.severity) - rank(a.severity))
    .slice(0, 5);
  if (!lessons.length) return 'No prior lessons for this context.';
  return '## PAST LESSONS LEARNED\n' +
    lessons.map((l,i)=>`${i+1}. [${l.category}] ${l.summary} (${l.severity})`).join('\n') +
    '\nApply these. Do not repeat past mistakes.';
}
```

Semantic search = pgvector cosine over `lessons.embedding` filtered by token traits in `MarketContext`.

---

## 6. pgvector Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE lessons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT now(),
  category      TEXT NOT NULL,
  summary       TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical','important','note')),
  embedding     VECTOR(1024),            -- embedding dim per model
  trade_ids     UUID[],
  source        TEXT DEFAULT 'trade',    -- 'trade' | 'user'
  retired       BOOLEAN DEFAULT false,
  retired_reason TEXT
);
CREATE INDEX ON lessons USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON lessons (category) WHERE retired = false;

CREATE TABLE agent_identity ( id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL );
CREATE TABLE user_profile  ( user_id TEXT PRIMARY KEY, data JSONB NOT NULL );
```

**Embeddings:** use a small embedding model (e.g. local or provider). Store dim consistently. DeepSeek is chat-only; pair with a dedicated embeddings endpoint (e.g. OpenAI-compatible embeddings or local `bge`/`nomic`).

---

## 7. Lesson Lifecycle (prevent rot)

Daily curator job:
- Mark lessons stale (`>30d` and no recent corroborating trade) → `retire` (never delete; keep for audit).
- Merge near-duplicate lessons (cosine > 0.95).
- Detect contradictions → flag for operator review.

This keeps recalled lessons sharp and current.
