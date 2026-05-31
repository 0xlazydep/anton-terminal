/**
 * In-memory position book. Tracks open positions and, each poll, fetches the
 * real market price for every open mint from DexScreener (free, no key). PnL is
 * computed the way meme-coin scalpers think — as a market-cap multiple
 * ("in at 50K MC, out at 200K = 4x") — and stop-loss / take-profit exits are
 * resolved against it.
 *
 * On a failed fetch the last known price/market-cap is held unchanged: the
 * position simply does not move (and cannot trigger SL/TP) until a fetch
 * succeeds again. Prices are never invented.
 */

import { randomUUID } from "node:crypto";
import { fetchTokenMarket } from "@anton/ingestion";
import type { EventBus } from "@anton/realtime";
import type {
  ClosedPositionSnapshot,
  ExecutionMode,
  OpenPositionSnapshot,
  PositionOpenedEvent,
  TradeDecision,
} from "@anton/shared-types";

export interface PositionsSnapshot {
  positions: OpenPositionSnapshot[];
  history: ClosedPositionSnapshot[];
}
import {
  closePosition,
  insertOpenPosition,
  listClosedPositions,
  listOpenPositions,
  type Database,
} from "@anton/data";
import {
  publishPositionClosed,
  publishPositionOpened,
  publishPositionUpdate,
} from "./publish.js";

interface OpenPosition {
  id: string;
  mint: string;
  symbol?: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entryMarketCapUsd?: number;
  currentMarketCapUsd?: number;
  sizeSol: number;
  slPct: number;
  tpPct: number;
  mode: ExecutionMode;
  openedAt: number;
}

export interface PositionBookLimits {
  maxConcurrentPositions: number;
  preventDuplicateMint: boolean;
}

export interface PositionBookDeps {
  db?: Database;
  onError?: (msg: string) => void;
  swapSolForToken?: (tokenMint: string, solAmount: number) => Promise<{ txSignature: string }>;
  swapTokenForSol?: (tokenMint: string, solAmount: number) => Promise<{ txSignature: string }>;
}

export class PositionBook {
  private readonly positions = new Map<string, OpenPosition>();
  private realizedPnlSol = 0;
  private readonly history: ClosedPositionSnapshot[] = [];
  private readonly db?: Database;
  private readonly onError: (msg: string) => void;
  private readonly swapSolForToken?: (tokenMint: string, solAmount: number) => Promise<{ txSignature: string }>;
  private readonly swapTokenForSol?: (tokenMint: string, solAmount: number) => Promise<{ txSignature: string }>;

  constructor(
    private readonly bus: EventBus,
    private readonly limits: PositionBookLimits,
    deps: PositionBookDeps = {},
  ) {
    this.db = deps.db;
    this.onError = deps.onError ?? (() => {});
    this.swapSolForToken = deps.swapSolForToken;
    this.swapTokenForSol = deps.swapTokenForSol;
  }

  private persist(op: Promise<void>): void {
    op.catch((err) => this.onError(`db persist: ${String(err).slice(0, 120)}`));
  }

  async loadFromDb(mode?: ExecutionMode): Promise<void> {
    if (!this.db) return;
    this.positions.clear();
    this.history.length = 0;
    const open = await listOpenPositions(this.db, mode);
    for (const r of open) {
      this.positions.set(r.id, {
        id: r.id,
        mint: r.mint,
        symbol: r.symbol,
        entryPriceUsd: r.entryPriceUsd,
        currentPriceUsd: r.entryPriceUsd,
        entryMarketCapUsd: r.entryMarketCapUsd,
        currentMarketCapUsd: r.entryMarketCapUsd,
        sizeSol: r.sizeSol,
        slPct: r.stopLossPct,
        tpPct: r.takeProfitPct,
        mode: r.mode,
        openedAt: r.openedAt,
      });
    }
    const closed = await listClosedPositions(this.db, 100, mode);
    for (const r of closed) {
      this.history.push({
        id: r.id,
        mint: r.mint,
        symbol: r.symbol,
        entryPriceUsd: r.entryPriceUsd,
        currentPriceUsd: r.exitPriceUsd,
        entryMarketCapUsd: r.entryMarketCapUsd,
        currentMarketCapUsd: r.entryMarketCapUsd,
        sizeSol: r.sizeSol,
        pnlPct: r.pnlPct,
        pnlSol: r.pnlSol,
        slPct: r.stopLossPct,
        tpPct: r.takeProfitPct,
        mode: r.mode,
        openedAt: r.openedAt,
        closePriceUsd: r.exitPriceUsd,
        reason: r.reason,
        closedAt: r.closedAt,
      });
    }
  }

  snapshotState(): PositionsSnapshot {
    const positions: OpenPositionSnapshot[] = [...this.positions.values()].map((p) => {
      const pnlPct = this.pnlPct(p);
      return {
        id: p.id,
        mint: p.mint,
        symbol: p.symbol,
        entryPriceUsd: p.entryPriceUsd,
        currentPriceUsd: p.currentPriceUsd,
        entryMarketCapUsd: p.entryMarketCapUsd,
        currentMarketCapUsd: p.currentMarketCapUsd,
        sizeSol: p.sizeSol,
        pnlPct,
        pnlSol: p.sizeSol * (pnlPct / 100),
        slPct: p.slPct,
        tpPct: p.tpPct,
        mode: p.mode,
        openedAt: p.openedAt,
      };
    });
    return { positions, history: [...this.history] };
  }

  get count(): number {
    return this.positions.size;
  }

  atCapacity(): boolean {
    return this.positions.size >= this.limits.maxConcurrentPositions;
  }

  totalPnlSol(): number {
    let unrealized = 0;
    for (const pos of this.positions.values()) {
      unrealized += pos.sizeSol * (this.pnlPct(pos) / 100);
    }
    return this.realizedPnlSol + unrealized;
  }

  hasMint(mint: string): boolean {
    for (const pos of this.positions.values()) {
      if (pos.mint === mint) return true;
    }
    return false;
  }

  async open(
    decision: TradeDecision,
    entryPriceUsd: number,
    mode: ExecutionMode,
    entryMarketCapUsd?: number,
  ): Promise<boolean> {
    if (decision.action !== "BUY" || !decision.size_sol) return false;
    if (this.atCapacity()) return false;
    if (this.limits.preventDuplicateMint && this.hasMint(decision.token)) {
      return false;
    }

    let txSig: string | undefined;
    if (mode === "live" && this.swapSolForToken) {
      const sizeSol = decision.size_sol;
      try {
        const result = await this.swapSolForToken(decision.token, sizeSol);
        txSig = result.txSignature;
      } catch (err) {
        this.onError(`swap failed: ${String(err).slice(0, 120)}`);
        return false;
      }
    }

    const id = randomUUID();
    const pos: OpenPosition = {
      id,
      mint: decision.token,
      symbol: decision.symbol,
      entryPriceUsd,
      currentPriceUsd: entryPriceUsd,
      entryMarketCapUsd,
      currentMarketCapUsd: entryMarketCapUsd,
      sizeSol: decision.size_sol,
      slPct: Math.abs(decision.stop_loss_pct ?? 20),
      tpPct: decision.take_profit_pct ?? 50,
      mode,
      openedAt: Date.now(),
    };
    this.positions.set(id, pos);

    if (this.db) {
      this.persist(
        insertOpenPosition(this.db, {
          id,
          mint: pos.mint,
          symbol: pos.symbol,
          sizeSol: pos.sizeSol,
          entryPriceUsd,
          stopLossPct: pos.slPct,
          takeProfitPct: pos.tpPct,
          mode,
          entryMarketCapUsd,
          openedAt: pos.openedAt,
        }),
      );
    }

    const opened: PositionOpenedEvent = {
      id,
      mint: pos.mint,
      symbol: pos.symbol,
      entryPriceUsd,
      entryMarketCapUsd,
      sizeSol: pos.sizeSol,
      txSig,
      mode,
    };
    publishPositionOpened(this.bus, opened);
    return true;
  }

  /**
   * Poll the live price of every open position from DexScreener and resolve
   * SL/TP exits. Positions whose fetch fails keep their last price untouched.
   */
  async poll(): Promise<void> {
    await Promise.all(
      [...this.positions.values()].map((pos) => this.refresh(pos)),
    );
  }

  private async refresh(pos: OpenPosition): Promise<void> {
    let priceUsd: number | undefined;
    let marketCapUsd: number | undefined;
    try {
      const snap = await fetchTokenMarket(pos.mint);
      priceUsd = snap.priceUsd;
      marketCapUsd = snap.marketCapUsd;
    } catch {
      return; // hold last price: no movement until a fetch succeeds again
    }

    if (priceUsd !== undefined && priceUsd > 0) pos.currentPriceUsd = priceUsd;
    if (marketCapUsd !== undefined && marketCapUsd > 0) pos.currentMarketCapUsd = marketCapUsd;

    const pnlPct = this.pnlPct(pos);

    if (pnlPct <= -pos.slPct) {
      this.close(pos, pnlPct, "stop-loss hit");
      return;
    }
    if (pnlPct >= pos.tpPct) {
      this.close(pos, pnlPct, "take-profit hit");
      return;
    }

    publishPositionUpdate(this.bus, {
      id: pos.id,
      currentPriceUsd: pos.currentPriceUsd,
      currentMarketCapUsd: pos.currentMarketCapUsd,
      pnlPct,
      slPct: pos.slPct,
      tpPct: pos.tpPct,
    });
  }

  /**
   * PnL as a market-cap multiple: (currentMC - entryMC) / entryMC. For a
   * fixed-supply token the price ratio equals the MC ratio, so we fall back to
   * price when market cap is unavailable — same number, never a random one.
   */
  private pnlPct(pos: OpenPosition): number {
    const haveMc =
      pos.entryMarketCapUsd !== undefined &&
      pos.entryMarketCapUsd > 0 &&
      pos.currentMarketCapUsd !== undefined;
    if (haveMc) {
      return (
        ((pos.currentMarketCapUsd! - pos.entryMarketCapUsd!) /
          pos.entryMarketCapUsd!) *
        100
      );
    }
    if (pos.entryPriceUsd > 0) {
      return ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    }
    return 0;
  }

  private async close(pos: OpenPosition, pnlPct: number, reason: string): Promise<void> {
    if (pos.mode === "live" && this.swapTokenForSol) {
      try {
        const result = await this.swapTokenForSol(pos.mint, pos.sizeSol);
        this.onError(`swap SELL ${pos.symbol ?? pos.mint.slice(0, 8)} → ${result.txSignature.slice(0, 16)}...`);
      } catch (err) {
        this.onError(`swap sell failed: ${String(err).slice(0, 120)} — position kept open`);
        return;
      }
    }

    this.positions.delete(pos.id);
    const pnlSol = pos.sizeSol * (pnlPct / 100);
    this.realizedPnlSol += pnlSol;
    const closedAt = Date.now();

    this.history.unshift({
      id: pos.id,
      mint: pos.mint,
      symbol: pos.symbol,
      entryPriceUsd: pos.entryPriceUsd,
      currentPriceUsd: pos.currentPriceUsd,
      entryMarketCapUsd: pos.entryMarketCapUsd,
      currentMarketCapUsd: pos.currentMarketCapUsd,
      sizeSol: pos.sizeSol,
      pnlPct,
      pnlSol,
      slPct: pos.slPct,
      tpPct: pos.tpPct,
      mode: pos.mode,
      openedAt: pos.openedAt,
      closePriceUsd: pos.currentPriceUsd,
      reason,
      closedAt,
    });
    if (this.history.length > 100) this.history.length = 100;

    if (this.db) {
      this.persist(
        closePosition(this.db, {
          id: pos.id,
          exitPriceUsd: pos.currentPriceUsd,
          pnlSol,
          pnlPct,
          reason,
          closedAt,
        }),
      );
    }

    publishPositionClosed(this.bus, {
      id: pos.id,
      pnlSol,
      pnlPct,
      closePriceUsd: pos.currentPriceUsd,
      reason,
    });
  }
}
