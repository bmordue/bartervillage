/**
 * Order execution registry (spec §4.2, §13; extended by Milestone 2).
 *
 * Each handler validates and executes one order atomically. Handlers must not
 * mutate state until all preconditions pass; a failure must leave no trace.
 * Later milestones register additional handlers in `ORDER_HANDLERS`.
 */

import type {
  ContentPack,
  Order,
  OrderPayloadMap,
  OrderType,
  Player,
  RegionId,
  WorldState,
} from "./types.js";
import type { EventLog } from "./events.js";
import { spendEnergy, travelCostBetween } from "./world.js";

export interface OrderOutcome {
  ok: boolean;
  reason: string | null;
}

export interface OrderExecutionContext {
  state: WorldState;
  content: ContentPack;
  order: Order;
  player: Player;
  /** The region the player is in at this point in their queue. */
  location: { regionId: RegionId };
  /** Regions reached by travel orders earlier in this queue. */
  reachable: Set<RegionId>;
  /** Regions visited by travel orders, in order, for the replay path. */
  path: RegionId[];
  /** The tick event log, supplied by the engine so handlers can emit events. */
  events?: EventLog;
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
  if (!context.state.regions.some((region) => region.id === payload.regionId)) {
    return orderFailed(`Unknown region ${payload.regionId}`);
  }
  const cost = travelCostBetween(
    context.state,
    context.content,
    context.location.regionId,
    payload.regionId,
  );
  if (!Number.isFinite(cost)) {
    return orderFailed("Travel cost could not be calculated");
  }
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to travel (needs ${cost})`);
  }
  if (payload.regionId !== context.location.regionId) {
    context.path.push(payload.regionId);
  }
  context.reachable.add(payload.regionId);
  context.location.regionId = payload.regionId;
  return orderSucceeded;
});
