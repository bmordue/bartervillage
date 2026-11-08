/**
 * Queue-time locking (spec §4.2, §6.1, §7; M2.A06, M2.D05, M2.D11, M2.E02).
 *
 * Orders that spend goods lock them when queued so they cannot be offered,
 * cooked, gifted or re-spent before resolution. The engine releases the lock if
 * the order fails; a successful handler either consumes the goods or transfers
 * the lock to an offer, building or craft job.
 */

import { lockItems } from "./inventory.js";
import { appendOrder, findOrder, type NewOrder } from "./queue.js";
import type {
  ContentPack,
  ItemStack,
  Order,
  OrderId,
  OrderPayloadMap,
  OrderType,
  PlotId,
  WorldState,
} from "./types.js";
import { plotOfPlayer } from "./world.js";

export interface LockPlan {
  plotId: PlotId;
  items: ItemStack[];
}

export type QueueOrderResult = { ok: true; order: Order } | { ok: false; reason: string };

function copyStacks(stacks: readonly ItemStack[]): ItemStack[] {
  return stacks.map((stack) => ({ item: stack.item, quantity: stack.quantity }));
}

function buildingById(state: WorldState, buildingId: string) {
  return state.buildings.find((building) => building.id === buildingId);
}

/**
 * Work out which goods an order must lock when queued. Orders that do not
 * spend goods return null.
 */
export function lockPlan(state: WorldState, content: ContentPack, order: Order): LockPlan | null {
  const plot = plotOfPlayer(state, order.playerId);
  if (!plot) {
    return null;
  }

  switch (order.type) {
    case "build": {
      const payload = order.payload as OrderPayloadMap["build"];
      const definition = content.buildings.find((entry) => entry.id === payload.building);
      const level = definition?.levels.find((entry) => entry.level === 1);
      return level ? { plotId: plot.id, items: copyStacks(level.cost) } : null;
    }
    case "upgrade": {
      const payload = order.payload as OrderPayloadMap["upgrade"];
      const building = buildingById(state, payload.buildingId);
      if (!building) {
        return null;
      }
      const definition = content.buildings.find((entry) => entry.id === building.type);
      const level = definition?.levels.find((entry) => entry.level === building.level + 1);
      return level ? { plotId: plot.id, items: copyStacks(level.cost) } : null;
    }
    case "craft": {
      const payload = order.payload as OrderPayloadMap["craft"];
      const recipe = content.recipes.find((entry) => entry.id === payload.recipeId);
      return recipe ? { plotId: plot.id, items: copyStacks(recipe.inputs) } : null;
    }
    case "post_offer":
    case "counter_offer": {
      const payload = order.payload as
        OrderPayloadMap["post_offer"] | OrderPayloadMap["counter_offer"];
      return { plotId: plot.id, items: copyStacks(payload.gives) };
    }
    case "accept_offer": {
      const payload = order.payload as OrderPayloadMap["accept_offer"];
      const offer = state.offers.find((entry) => entry.id === payload.offerId);
      return offer ? { plotId: plot.id, items: copyStacks(offer.wants) } : null;
    }
    case "contribute_goal": {
      const payload = order.payload as OrderPayloadMap["contribute_goal"];
      return { plotId: plot.id, items: copyStacks(payload.items) };
    }
    case "gift": {
      const payload = order.payload as OrderPayloadMap["gift"];
      return { plotId: plot.id, items: copyStacks(payload.items) };
    }
    default:
      return null;
  }
}

/** Lock inputs and queue the order atomically (spec §4.2). */
export function queueOrder(
  state: WorldState,
  content: ContentPack,
  input: NewOrder,
): QueueOrderResult {
  if (findOrder(state, input.id)) {
    return { ok: false, reason: `Order ${input.id} already exists` };
  }
  const draft = {
    id: input.id,
    playerId: input.playerId,
    tick: input.tick,
    sequence: input.sequence ?? state.nextOrderSequence,
    type: input.type,
    payload: input.payload,
    status: input.status ?? "queued",
    failureReason: null,
  } as Order;
  const plan = lockPlan(state, content, draft);
  if (plan && plan.items.length > 0 && !lockItems(state, plan.plotId, plan.items)) {
    return { ok: false, reason: "Not enough free goods to lock for this order" };
  }
  const order = appendOrder(state, input);
  if (plan && plan.items.length > 0) {
    state.orderLocks.push({
      orderId: order.id,
      plotId: plan.plotId,
      items: copyStacks(plan.items),
    });
  }
  return { ok: true, order };
}

export function preLockedItems(state: WorldState, orderId: OrderId): ItemStack[] | undefined {
  return state.orderLocks.find((lock) => lock.orderId === orderId)?.items;
}

/** Forget a lock without unlocking: the handler consumed or transferred it. */
export function discardOrderLock(state: WorldState, orderId: OrderId): void {
  const index = state.orderLocks.findIndex((lock) => lock.orderId === orderId);
  if (index >= 0) {
    state.orderLocks.splice(index, 1);
  }
}

export function hasOrderLock(state: WorldState, orderId: OrderId): boolean {
  return state.orderLocks.some((lock) => lock.orderId === orderId);
}

export type { OrderType };
