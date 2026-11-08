/**
 * Cosmetic decorations (spec §6.2; M2.D13, M6.12-M6.13).
 */

import { canRemoveFree, removeFreeItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
} from "./orders.js";
import type { Decoration, OrderPayloadMap } from "./types.js";
import { cropAtTile, orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

function placeDecorationHandler(context: OrderExecutionContext) {
  const payload = context.order.payload as OrderPayloadMap["place_decoration"];
  const plot = plotOfPlayer(context.state, context.player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }
  const definition = context.content.decorations.find((entry) => entry.id === payload.decoration);
  if (!definition) {
    return orderFailed(`Unknown decoration ${payload.decoration}`);
  }
  const { x, y } = payload.tile;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= plot.width ||
    y >= plot.height
  ) {
    return orderFailed("Tile is outside the player's plot");
  }
  if (cropAtTile(context.state, plot.id, x, y)) {
    return orderFailed("Tile already has a crop");
  }
  const occupied = context.state.decorations.some(
    (decoration) =>
      decoration.plotId === plot.id && decoration.tileX === x && decoration.tileY === y,
  );
  if (occupied) {
    return orderFailed("Tile already has a decoration");
  }
  if (!canRemoveFree(context.state, plot.id, definition.cost)) {
    return orderFailed("Not enough free stock for the decoration");
  }
  const cost = orderEnergyCost(context.content, "place_decoration");
  if (context.player.energy < cost) {
    return orderFailed(`Not enough energy (needs ${cost})`);
  }
  removeFreeItems(context.state, plot.id, definition.cost);
  spendEnergy(context.player, cost);
  const decoration: Decoration = {
    id: `decoration:${context.order.id}`,
    plotId: plot.id,
    type: definition.id,
    tileX: x,
    tileY: y,
  };
  context.state.decorations.push(decoration);
  return orderSucceeded;
}

export function registerDecorationHandlers(): void {
  registerOrderHandler("place_decoration", placeDecorationHandler);
}
