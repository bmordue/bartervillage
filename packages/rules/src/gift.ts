/**
 * Gift order handler (M6.08).
 *
 * A player can gift goods remotely. The giver pays energy cost, locks and
 * transfers the goods to the recipient's plot. The recipient must have storage
 * capacity for the goods. The giver earns +5 goodwill.
 *
 * No travel is involved; gifts are board-wide and can be sent to any plot.
 */

import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import type { ItemStack, PlayerId } from "./types.js";
import {
  addItems,
  canAddItems,
  canLockItems,
  consumeLockedItems,
  lockItems,
  unlockItems,
} from "./inventory.js";
import { orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

interface GiftPayload {
  toPlayerId: PlayerId;
  items: ItemStack[];
}

function parseGiftPayload(payload: unknown): GiftPayload | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p["toPlayerId"] !== "string") {
    return null;
  }
  const items = p["items"];
  if (!Array.isArray(items)) {
    return null;
  }
  if (!items.every((item) => typeof item === "object" && item !== null)) {
    return null;
  }
  const result: GiftPayload = { toPlayerId: p["toPlayerId"], items: [] };
  for (const item of items) {
    const stack = item as Record<string, unknown>;
    if (
      typeof stack.item !== "string" ||
      typeof stack.quantity !== "number" ||
      stack.quantity < 1
    ) {
      return null;
    }
    result.items.push({ item: stack.item, quantity: stack.quantity });
  }
  return result;
}

function giftHandler(context: OrderExecutionContext): OrderOutcome {
  const payload = parseGiftPayload(context.order.payload);
  if (!payload) {
    return orderFailed("Invalid gift payload");
  }

  const giver = context.state.players.find((p) => p.id === context.player.id);
  if (!giver) {
    return orderFailed(`Unknown player ${context.player.id}`);
  }

  const targetPlot = plotOfPlayer(context.state, payload.toPlayerId);
  if (!targetPlot) {
    return orderFailed(`Target player ${payload.toPlayerId} has no plot`);
  }

  const sourcePlot = plotOfPlayer(context.state, giver.id);
  if (!sourcePlot) {
    return orderFailed(`Giver ${giver.id} has no plot`);
  }

  if (sourcePlot.id === targetPlot.id) {
    return orderFailed("Cannot gift to your own plot");
  }

  const needsItems = payload.items.length > 0;
  if (needsItems) {
    if (!canAddItems(context.state, context.content, targetPlot.id, payload.items)) {
      return orderFailed(`Target plot lacks storage capacity for the gift`);
    }
    const canLock =
      context.preLockedItems ?? canLockItems(context.state, sourcePlot.id, payload.items);
    if (!canLock) {
      return orderFailed(`Not enough free stock to lock for this order`);
    }
    const cost = orderEnergyCost(context.content, context.order.type);
    if (!spendEnergy(giver, cost)) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }
    if (!context.preLockedItems) {
      lockItems(context.state, sourcePlot.id, payload.items);
    }
    const consumed = consumeLockedItems(context.state, sourcePlot.id, payload.items);
    if (!consumed) {
      if (!context.preLockedItems) {
        unlockItems(context.state, sourcePlot.id, payload.items);
      }
      return orderFailed("Could not consume locked items");
    }
    addItems(context.state, context.content, targetPlot.id, payload.items);

    const entry = context.state.goodwill.find((row) => row.playerId === giver.id);
    const goodwillAmount = context.content.goodwill.gift;
    if (entry) {
      entry.score += goodwillAmount;
    } else {
      context.state.goodwill.push({ playerId: giver.id, score: goodwillAmount });
    }

    context.events?.emit("gift", {
      fromPlayerId: giver.id,
      toPlayerId: payload.toPlayerId,
      items: payload.items,
    });

    return orderSucceeded;
  } else {
    // Empty gift: no goods moved, only goodwill awarded.
    const entry = context.state.goodwill.find((row) => row.playerId === giver.id);
    const goodwillAmount = context.content.goodwill.gift;
    if (entry) {
      entry.score += goodwillAmount;
    } else {
      context.state.goodwill.push({ playerId: giver.id, score: goodwillAmount });
    }

    context.events?.emit("gift", {
      fromPlayerId: giver.id,
      toPlayerId: payload.toPlayerId,
      items: [],
    });

    return orderSucceeded;
  }
}

export function registerGiftHandlers(): void {
  registerOrderHandler("gift", giftHandler);
}

registerGiftHandlers();
