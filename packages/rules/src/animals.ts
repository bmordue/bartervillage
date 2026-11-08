/**
 * Animal order handler and production rules (spec §6.2; M2.B09-M2.B10).
 */

import type { EventLog } from "./events.js";
import { addItems, canAddItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
} from "./orders.js";
import type { AnimalDefinition, ContentPack, OrderPayloadMap, WorldState } from "./types.js";
import { orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

function animalDefinition(content: ContentPack, type: string): AnimalDefinition | undefined {
  return content.animals.find((definition) => definition.id === type);
}

function feedHandler(context: OrderExecutionContext) {
  const payload = context.order.payload as OrderPayloadMap["feed"];
  const plot = plotOfPlayer(context.state, context.player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }
  const animal = context.state.animals.find(
    (candidate) => candidate.id === payload.animalId && candidate.plotId === plot.id,
  );
  if (!animal) {
    return orderFailed(`Animal ${payload.animalId} is not on the player's plot`);
  }
  const cost = orderEnergyCost(context.content, "feed");
  if (context.player.energy < cost) {
    return orderFailed(`Not enough energy to feed (needs ${cost})`);
  }
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to feed (needs ${cost})`);
  }
  animal.fed = true;
  return orderSucceeded;
}

export function registerAnimalHandlers(): void {
  registerOrderHandler("feed", feedHandler);
}

registerAnimalHandlers();

export function runAnimalProduction(
  state: WorldState,
  content: ContentPack,
  events: EventLog,
): void {
  for (const animal of state.animals) {
    if (!animal.fed) {
      continue;
    }
    const definition = animalDefinition(content, animal.type);
    if (!definition) {
      continue;
    }
    if (!canAddItems(state, content, animal.plotId, definition.produces)) {
      continue;
    }
    addItems(state, content, animal.plotId, definition.produces);
    for (const stack of definition.produces) {
      events.emit("animal_produced", {
        animalId: animal.id,
        plotId: animal.plotId,
        item: stack.item,
        quantity: stack.quantity,
      });
    }
  }
  for (const animal of state.animals) {
    animal.fed = false;
  }
}
