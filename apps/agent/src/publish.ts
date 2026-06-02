/**
 * Typed publish helpers — wrap raw bus.publish() with the exact envelope each
 * channel's Socket.IO / SSE bridge expects (see @anton/realtime socket-server
 * + sse). Keeping these in one place prevents shape drift between the agent
 * (producer) and the server (consumer).
 */

import {
  CHANNELS,
  type EventBus,
} from "@anton/realtime";
import type {
  AgentStatusEvent,
  EntryDecisionEvent,
  HoldingsSnapshotEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
  PositionClosedEvent,
  ReasoningStepEvent,
  ScreeningResultEvent,
  WalletEnteredEvent,
  WalletExitedEvent,
  FeeBreakdownEvent,
} from "@anton/shared-types";

export function publishReasoningStep(bus: EventBus, data: ReasoningStepEvent): void {
  void bus.publish(CHANNELS.reasoning, { type: "reasoning_step", data });
}

export function publishDecision(bus: EventBus, data: EntryDecisionEvent): void {
  void bus.publish(CHANNELS.reasoning, { type: "entry_decision", data });
}

export function publishScreening(bus: EventBus, data: ScreeningResultEvent): void {
  void bus.publish(CHANNELS.screening, data);
}

export function publishStatus(bus: EventBus, data: AgentStatusEvent): void {
  void bus.publish(CHANNELS.status, data);
}

export function publishPositionOpened(bus: EventBus, data: PositionOpenedEvent): void {
  void bus.publish(CHANNELS.trading, { type: "position_opened", data });
}

export function publishPositionUpdate(bus: EventBus, data: PositionUpdateEvent): void {
  void bus.publish(CHANNELS.trading, { type: "position_update", data });
}

export function publishPositionClosed(bus: EventBus, data: PositionClosedEvent): void {
  void bus.publish(CHANNELS.trading, { type: "position_closed", data });
}

export function publishHoldingsSnapshot(bus: EventBus, data: HoldingsSnapshotEvent): void {
  void bus.publish(CHANNELS.trading, { type: "holdings_snapshot", data });
}

export function publishWalletEntered(bus: EventBus, data: WalletEnteredEvent): void {
  void bus.publish(CHANNELS.smartWallet, { type: "wallet_entered", data });
}

export function publishWalletExited(bus: EventBus, data: WalletExitedEvent): void {
  void bus.publish(CHANNELS.smartWallet, { type: "wallet_exited", data });
}

export function publishFeeBreakdown(bus: EventBus, data: FeeBreakdownEvent): void {
  void bus.publish(CHANNELS.trading, { type: "fee_breakdown", data });
}
