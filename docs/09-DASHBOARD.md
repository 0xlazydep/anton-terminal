# 09 — Dashboard (Cyberpunk · Brutalism · Minimal · B&W)

Professional realtime trading terminal. Next.js + shadcn/ui, monospace, zero-radius, strict black & white. Socket.IO for trading data, SSE for agent reasoning.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React + TypeScript (strict) |
| Styling | Tailwind CSS 4 (`@theme`, OKLCH) + shadcn/ui (Radix) |
| Font | JetBrains Mono (Geist Mono / IBM Plex Mono fallback) |
| Charts | TradingView Lightweight Charts (candles) + Recharts (PnL bars) |
| Server state | TanStack Query v5 |
| Client state | Zustand (+ persist) |
| Realtime | Socket.IO (trading, bidi) + SSE (reasoning, server→client) |
| Virtual lists | `@tanstack/react-virtual` |
| Layout | `react-grid-layout` (draggable resizable panels) |
| Animation | Framer Motion (functional only: scanline, flicker, typing) |

---

## 2. Design System — Black & White Brutalist Terminal

**Aesthetic rules:** zero border radius · monospace everywhere · pure B&W (color only for profit-green / loss-red) · high contrast · dense data grids · no decorative motion. Optional CRT scanline overlay for cyberpunk flavor.

```css
/* apps/dashboard/app/globals.css */
@import "tailwindcss";

@theme inline {
  --font-sans: 'JetBrains Mono', 'Geist Mono', monospace;
  --font-mono: 'JetBrains Mono', monospace;
  --radius: 0rem; --radius-sm: 0rem; --radius-md: 0rem; --radius-lg: 0rem;
}

:root {                              /* light: white bg, black ink */
  --background: oklch(1 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(0.97 0 0);
  --primary: oklch(0 0 0);
  --primary-foreground: oklch(1 0 0);
  --muted-foreground: oklch(0.4 0 0);
  --border: oklch(0 0 0);
  --ring: oklch(0 0 0);
  /* semantic states (the ONLY color) */
  --profit: oklch(0.72 0.19 150);    /* green */
  --loss:   oklch(0.62 0.22 25);     /* red */
}
.dark {                              /* dark: near-black bg, white ink */
  --background: oklch(0.07 0 0);
  --foreground: oklch(1 0 0);
  --card: oklch(0.1 0 0);
  --primary: oklch(1 0 0);
  --primary-foreground: oklch(0 0 0);
  --muted-foreground: oklch(0.55 0 0);
  --border: oklch(1 0 0 / 15%);
  --ring: oklch(1 0 0);
  --profit: oklch(0.8 0.18 150);
  --loss:   oklch(0.68 0.21 25);
  --scanline-opacity: 0.03;
}
```

**Principles in practice:**
1. Sharp edges — no rounding on cards, buttons, inputs, badges.
2. Tabular numerals, uppercase letter-spaced labels, monospace alignment for all stats.
3. WCAG-AA contrast minimum; muted text never below threshold.
4. Borders are structural (1px solid) — the brutalist grid.
5. Profit green / loss red are the only hues; everything else B&W.

Reference themes to mine: voidframe-ui, GlitchCN-UI (scanlines), SMUI terminal, Touch Grass DS.

---

## 3. Layout (Panels)

Draggable grid (`react-grid-layout`). Default panels:

```
┌───────────────────────────────────────────────────────────────┐
│ HEADER:  ANTON ▮ status[scanning] ▮ MODE[DRY-RUN] ▮ SOL bal ▮ PnL today │
├──────────────────────────┬────────────────────────────────────┤
│  PRICE CHART (candles)    │  AGENT REASONING (live stream)      │
│  TradingView Lightweight  │  SSE: reasoning_step / decision     │
│                           │  "Why I entered / skipped / SL'd"   │
├──────────────────────────┼────────────────────────────────────┤
│  OPEN POSITIONS (table)   │  LIVE SCREENING (pipeline results)  │
│  PnL, SL/TP, hold, mirror │  layer-by-layer pass/fail + score   │
├──────────────────────────┼────────────────────────────────────┤
│  CONTROLS                 │  SMART-WALLET FEED                   │
│  mode toggle, spend caps  │  who entered/exited tracked tokens  │
│  emergency stop           │  trust, net flow                    │
└──────────────────────────┴────────────────────────────────────┘
```

**Key UX:** the Reasoning panel is the centerpiece — Anton narrates every decision with its `reason`. Operators watch the agent "think" in realtime.

---

## 4. Realtime Transport

**Split:** Socket.IO (bidirectional trading) + SSE (server→client reasoning/audit).

- Socket.IO runs as a dedicated Node process (App Router needs custom/standalone WS server) behind Nginx; sticky sessions if scaled.
- SSE via Next.js Route Handler returning a `ReadableStream` (`text/event-stream`), `: keepalive` every 25s.

```typescript
// apps/dashboard/hooks/use-realtime.ts
const socket = io('/trading', { transports: ['websocket'], auth: { token } });
socket.on('position_update', u => queryClient.setQueryData(['positions'], merge(u)));
socket.on('agent_status',   s => useUI.getState().setStatus(s));

const es = new EventSource('/api/agent/stream');
es.addEventListener('reasoning_step', e =>
  queryClient.setQueryData(['reasoning'], r => [...(r||[]), JSON.parse(e.data)].slice(-500)));
```

---

## 5. Event Contract (Backend → Frontend)

```
TRADING (Socket.IO, bidi):
  position_opened   { id, mint, symbol, entryPrice, size, txSig, mode }
  position_closed   { id, pnlSol, pnlPct, closePrice, reason, txSig }
  position_update   { id, currentPrice, pnlPct, slPct, tpPct }
  price_update      { mint, priceUsd, priceSol, ts }
  holdings_snapshot { positions[], totalPnl, solBalance }

SCREENING (server→client):
  screening_started { mint, symbol }
  screening_layer_1 { mint, checks, passed }
  screening_layer_2 { mint, liquidity, pairAge, volume }
  screening_result  { mint, score, verdict, flags }

REASONING (SSE):
  reasoning_step    { step, thought, confidence, ts }
  entry_decision    { mint, symbol, action, conviction, sizeSol, reason }
  dry_run_notice    { mint, whatWouldHappen }
  alert             { level, message }

SMART-WALLET (server→client):
  wallet_entered    { wallet, trust, mint, priceUsd, ts }
  wallet_exited     { wallet, mint, fraction, ts }

CONTROLS (client→server):
  set_mode          { mode: 'dry-run'|'live' }
  set_spend_limits  { minSol, maxSol }
  manual_entry      { mint, sizeSol, slippage }
  emergency_stop    {}

STATUS (bidi):
  agent_status      { state: 'scanning'|'analyzing'|'entering'|'watching'|'idle', uptime }
  heartbeat         { ts }
```

---

## 6. State Management Pattern

- **TanStack Query** = server state (positions, screening, reasoning log, config). WS/SSE events merge into cache via `setQueryData` (no polling).
- **Zustand** = pure UI state (mode toggle, spend inputs, selected token, active panel, toasts). `persist` only trading config.

```typescript
// apps/dashboard/store/ui.ts
export const useUI = create(persist((set) => ({
  mode: 'dry-run', minSpendSol: 0.1, maxSpendSol: 0.5,
  selectedMint: null, status: 'idle',
  setMode: (mode) => set({ mode }),
  setSpend: (minSpendSol, maxSpendSol) => set({ minSpendSol, maxSpendSol }),
}), { name: 'anton-ui', partialize: s => ({ mode: s.mode, minSpendSol: s.minSpendSol, maxSpendSol: s.maxSpendSol }) }));
```

---

## 7. Config Controls (Operator → Agent)

The Controls panel writes config back to the backend (the "set config for entry" requirement):
- **Mode:** DRY-RUN / LIVE toggle (prominent, guarded confirm for LIVE).
- **Spend:** `minSpendSol`, `maxSpendSol` per entry (the entry reference/acuan).
- **Risk:** max concurrent positions, daily loss cap, default SL/TP, screening preset (strict/normal/relaxed).
- **Emergency stop:** halt all entries, optionally flatten positions.

Changes round-trip via Socket.IO `set_*` events → validated against hard caps → persisted to `config` (see `10-CONFIG-DEPLOY.md`) → confirmed back to UI.

> **Implementation note:** the dashboard is the most visual-heavy deliverable. When built, delegate to the `visual-engineering` category with `ui-ux-pro-max` + `ckm:ui-styling` skills for the B&W cyberpunk/brutalist execution.
