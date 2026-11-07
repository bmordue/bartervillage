/**
 * Order queue model (spec §4.2, M2.A01).
 *
 * Orders carry their tick and sequence so a queue edit before the tick can be
 * validated without guessing which resolution they belong to.
 */

import type {
  Order,
  OrderId,
  OrderPayloadMap,
  OrderStatus,
  OrderType,
  PlayerId,
  Tick,
  WorldState,
} from "./types.js";

export interface NewOrder<K extends OrderType = OrderType> {
  id: OrderId;
  playerId: PlayerId;
  tick: Tick;
  sequence?: number;
  type: K;
  payload: OrderPayloadMap[K];
  status?: OrderStatus;
}

export function ordersOfPlayer(state: WorldState, playerId: PlayerId, tick?: Tick): Order[] {
  return state.orders
    .filter(
      (order) =>
        order.playerId === playerId &&
        (tick === undefined || order.tick === tick) &&
        order.status !== "cancelled",
    )
    .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function findOrder(state: WorldState, orderId: OrderId): Order | undefined {
  return state.orders.find((order) => order.id === orderId);
}

export function appendOrder<K extends OrderType>(state: WorldState, input: NewOrder<K>): Order {
  const sequence = input.sequence ?? state.nextOrderSequence;
  state.nextOrderSequence = Math.max(state.nextOrderSequence, sequence + 1);
  const order = {
    id: input.id,
    playerId: input.playerId,
    tick: input.tick,
    sequence,
    type: input.type,
    payload: input.payload,
    status: input.status ?? "queued",
    failureReason: null,
  } as Order;
  state.orders.push(order);
  return order;
}

export function appendOrders<K extends OrderType>(
  state: WorldState,
  inputs: readonly NewOrder<K>[],
): Order[] {
  return inputs.map((input) => appendOrder(state, input));
}

export function reorderQueue(
  state: WorldState,
  playerId: PlayerId,
  tick: Tick,
  orderedIds: readonly OrderId[],
): void {
  const queue = ordersOfPlayer(state, playerId, tick);
  const known = new Set(queue.map((order) => order.id));
  for (const id of orderedIds) {
    if (!known.has(id)) {
      throw new Error(`Order ${id} is not in ${playerId}'s queue for tick ${tick}`);
    }
  }
  if (orderedIds.length !== queue.length) {
    throw new Error("Reorder must include every order in the queue exactly once");
  }
  orderedIds.forEach((id, index) => {
    const order = queue.find((candidate) => candidate.id === id);
    if (order) {
      order.sequence = index + 1;
    }
  });
}

export function cancelOrder(state: WorldState, orderId: OrderId): boolean {
  const order = findOrder(state, orderId);
  if (!order || order.status !== "queued") {
    return false;
  }
  order.status = "cancelled";
  return true;
}

/** Remove a queued order entirely. Callers release its locks first (M2.A06). */
export function removeOrder(state: WorldState, orderId: OrderId): Order | null {
  const index = state.orders.findIndex((order) => order.id === orderId);
  if (index < 0) {
    return null;
  }
  const order = state.orders[index];
  if (!order || order.status !== "queued") {
    return null;
  }
  state.orders.splice(index, 1);
  return order;
}

/**
 * Expand a batch order into independent per-unit orders at queue time
 * (spec §4.2, M2.A05). The batch template is not itself queued.
 */
export function expandBatchOrder<K extends OrderType>(
  state: WorldState,
  template: NewOrder<K>,
  units: number,
  buildPayload: (template: NewOrder<K>, index: number) => OrderPayloadMap[K],
): Order[] {
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error("Batch size must be a positive integer");
  }
  const orders: Order[] = [];
  for (let index = 0; index < units; index += 1) {
    orders.push(
      appendOrder(state, {
        ...template,
        id: `${template.id}:${index}`,
        payload: buildPayload(template, index),
      }),
    );
  }
  return orders;
}
