/** Socket.IO server for bidirectional trading data + control events. */

import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { CHANNELS } from "@anton/shared-types";
import type {
  PositionOpenedEvent,
  PositionClosedEvent,
  PositionUpdateEvent,
  PriceUpdateEvent,
  HoldingsSnapshotEvent,
  ScreeningResultEvent,
  StateSnapshotEvent,
  WalletEnteredEvent,
  WalletExitedEvent,
  AgentStatusEvent,
  SetModeEvent,
  SetSpendLimitsEvent,
  SetRiskConfigEvent,
  ManualEntryEvent,
} from "@anton/shared-types";
import type { EventBus } from "./bus.js";

/** Server → client events. */
export interface ServerToClientEvents {
  position_opened: (e: PositionOpenedEvent) => void;
  position_closed: (e: PositionClosedEvent) => void;
  position_update: (e: PositionUpdateEvent) => void;
  price_update: (e: PriceUpdateEvent) => void;
  holdings_snapshot: (e: HoldingsSnapshotEvent) => void;
  screening_result: (e: ScreeningResultEvent) => void;
  wallet_entered: (e: WalletEnteredEvent) => void;
  wallet_exited: (e: WalletExitedEvent) => void;
  agent_status: (e: AgentStatusEvent) => void;
  state_snapshot: (e: StateSnapshotEvent) => void;
}

/** Replays current state to a client the moment it (re)connects. */
export type SnapshotProvider = () => StateSnapshotEvent | Promise<StateSnapshotEvent>;

/** Client → server control events. */
export interface ClientToServerEvents {
  set_mode: (e: SetModeEvent) => void;
  set_spend_limits: (e: SetSpendLimitsEvent) => void;
  set_risk_config: (e: SetRiskConfigEvent) => void;
  manual_entry: (e: ManualEntryEvent) => void;
  emergency_stop: () => void;
}

export interface ControlHandlers {
  onSetMode?: (e: SetModeEvent) => void;
  onSetSpendLimits?: (e: SetSpendLimitsEvent) => void;
  onSetRiskConfig?: (e: SetRiskConfigEvent) => void;
  onManualEntry?: (e: ManualEntryEvent) => void;
  onEmergencyStop?: () => void;
}

export interface TradingSocketOptions {
  httpServer: HttpServer;
  bus: EventBus;
  corsOrigin?: string | string[];
  controls?: ControlHandlers;
  getSnapshot?: SnapshotProvider;
}

/**
 * Creates a Socket.IO server on the '/trading' namespace. Bridges the Redis
 * event bus (backend → UI) and forwards control events (UI → backend).
 */
export function createTradingSocketServer(opts: TradingSocketOptions): SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents
> {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(opts.httpServer, {
    cors: { origin: opts.corsOrigin ?? "*" },
    transports: ["websocket"],
  });

  const trading = io.of("/trading");

  // Bridge bus → connected clients.
  void opts.bus.subscribe(CHANNELS.trading, (payload: unknown) => {
    const evt = payload as { type: keyof ServerToClientEvents; data: unknown };
    if (evt && evt.type) {
      trading.emit(evt.type, evt.data as never);
    }
  });
  void opts.bus.subscribe(CHANNELS.screening, (payload: unknown) => {
    trading.emit("screening_result", payload as ScreeningResultEvent);
  });
  void opts.bus.subscribe(CHANNELS.smartWallet, (payload: unknown) => {
    const evt = payload as { type: "wallet_entered" | "wallet_exited"; data: unknown };
    if (evt?.type === "wallet_entered") trading.emit("wallet_entered", evt.data as WalletEnteredEvent);
    if (evt?.type === "wallet_exited") trading.emit("wallet_exited", evt.data as WalletExitedEvent);
  });
  void opts.bus.subscribe(CHANNELS.status, (payload: unknown) => {
    trading.emit("agent_status", payload as AgentStatusEvent);
  });

  trading.on("connection", (socket) => {
    const c = opts.controls ?? {};
    socket.on("set_mode", (e) => c.onSetMode?.(e));
    socket.on("set_spend_limits", (e) => c.onSetSpendLimits?.(e));
    socket.on("set_risk_config", (e) => c.onSetRiskConfig?.(e));
    socket.on("manual_entry", (e) => c.onManualEntry?.(e));
    socket.on("emergency_stop", () => c.onEmergencyStop?.());

    if (opts.getSnapshot) {
      void Promise.resolve(opts.getSnapshot()).then((snap) => {
        socket.emit("state_snapshot", snap);
      });
    }
  });

  return io;
}
