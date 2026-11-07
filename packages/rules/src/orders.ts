/**
 * Order execution registry (spec §4.2, §13; extended by Milestone 2).
 *
 * Each handler validates and executes one order atomically. Handlers must not
 * mutate state until all preconditions pass; a failure must leave no trace.
 * Later milestones register additional handlers in `ORDER_HANDLERS`.
 */

import type { ContentPack, Order, OrderPayloadMap, OrderType, WorldState } from "./types.js";

export interface OrderOutcome {
  ok: boolean;
  reason: string | null;
}

export interface OrderExecutionContext {
  state: WorldState;
  content: ContentPack;
  order: Order;
  /** The region the player is in at this point in their queue. */
  location: { regionId: string };
  /** Regions reached by travel orders earlier in this queue. */
  reachable: Set<string>;
}

export type OrderHandler<K extends OrderType = OrderType> = (
  context: OrderExecutionContext & { order: Extract<Order, { type: K }> },
) => OrderOutcome;

export const orderSucceeded: OrderOutcome = { ok: true, reason: null };

export function orderFailed(reason: string): OrderOutcome {
  return { ok: false, reason };
}

const handlers = new Map<OrderType, OrderHandler>();

export function registerOrderHandler<K extends OrderType>(type: K, handler: OrderHandler<K>): void {
  handlers.set(type, handler as unknown as OrderHandler);
}

export function getOrderHandler(type: OrderType): OrderHandler | undefined {
  return handlers.get(type);
}

/**
 * Execute one order. Unsupported handlers fail cleanly so an unready player
 * never breaks the rest of the tick.
 */
export function resolveOrder(context: OrderExecutionContext): OrderOutcome {
  const handler = handlers.get(context.order.type);
  if (!handler) {
    return orderFailed(`No handler registered for order type ${context.order.type}`);
  }
  return handler(context);
}

// ---------------------------------------------------------------------------
// Travel is foundational, so it is registered here rather than in a later
// milestone module. Energy accounting is layered on in M2.A13.
// ---------------------------------------------------------------------------

registerOrderHandler("travel", (context) => {
  const payload = context.order.payload as OrderPayloadMap["travel"];
  context.reachable.add(payload.regionId);
  context.location.regionId = payload.regionId;
  return orderSucceeded;
});
