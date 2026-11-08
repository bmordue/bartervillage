/**
 * Missed-tick default orders (spec §4.4; M2.A17-M2.A20).
 */

import { registerAnimalHandlers } from "./animals.js";
import { registerCropHandlers } from "./crops.js";
import { appendOrder } from "./queue.js";
import type { ContentPack, Crop, CropDefinition, Order, Player, WorldState } from "./types.js";
import { freeCapacity, orderEnergyCost, plotOfPlayer, totalQuantity } from "./world.js";

function cropDefinition(content: ContentPack, crop: Crop): CropDefinition | undefined {
  return content.crops.find((definition) => definition.id === crop.type);
}

export function appendMissedTickDefaults(
  state: WorldState,
  player: Player,
  content: ContentPack,
): Order[] {
  const tick = state.world.currentTick;
  if (state.ready.some((entry) => entry.playerId === player.id && entry.tick === tick)) {
    return [];
  }
  const plot = plotOfPlayer(state, player.id);
  if (!plot) {
    return [];
  }

  const explicit = state.orders.filter(
    (order) => order.playerId === player.id && order.tick === tick && order.status !== "cancelled",
  );
  let sequence = state.nextOrderSequence;
  for (const order of explicit) {
    sequence = Math.max(sequence, order.sequence + 1);
  }

  let energy = player.energy;
  let capacity = freeCapacity(state, content, plot.id);
  let index = 0;
  let exhausted = false;
  const added: Order[] = [];
  const harvested = new Set<string>();

  const nextId = (): string => `default:${player.id}:${tick}:${index}`;

  if (player.defaults.harvest) {
    for (const crop of state.crops) {
      if (crop.plotId !== plot.id || crop.failed) {
        continue;
      }
      const definition = cropDefinition(content, crop);
      if (!definition) {
        continue;
      }
      if (tick < crop.plantedTick + crop.growthTicks) {
        continue;
      }
      const cost = orderEnergyCost(content, "harvest");
      const yieldSize = totalQuantity(definition.yield);
      if (energy < cost || capacity < yieldSize) {
        exhausted = true;
        break;
      }
      added.push(
        appendOrder(state, {
          id: nextId(),
          playerId: player.id,
          tick,
          sequence: sequence++,
          type: "harvest",
          payload: { tile: { x: crop.tileX, y: crop.tileY } },
        }),
      );
      harvested.add(crop.id);
      energy -= cost;
      capacity -= yieldSize;
      index += 1;
    }
  }

  if (!exhausted && player.defaults.water) {
    for (const crop of state.crops) {
      if (crop.plotId !== plot.id || crop.failed || crop.watered || harvested.has(crop.id)) {
        continue;
      }
      const cost = orderEnergyCost(content, "tend");
      if (energy < cost) {
        exhausted = true;
        break;
      }
      added.push(
        appendOrder(state, {
          id: nextId(),
          playerId: player.id,
          tick,
          sequence: sequence++,
          type: "tend",
          payload: { tile: { x: crop.tileX, y: crop.tileY } },
        }),
      );
      energy -= cost;
      index += 1;
    }
  }

  if (!exhausted && player.defaults.feed) {
    for (const animal of state.animals) {
      if (animal.plotId !== plot.id || animal.fed) {
        continue;
      }
      const cost = orderEnergyCost(content, "feed");
      if (energy < cost) {
        exhausted = true;
        break;
      }
      added.push(
        appendOrder(state, {
          id: nextId(),
          playerId: player.id,
          tick,
          sequence: sequence++,
          type: "feed",
          payload: { animalId: animal.id },
        }),
      );
      energy -= cost;
      index += 1;
    }
  }

  return added;
}

export function registerDefaultHandlers(): void {
  registerCropHandlers();
  registerAnimalHandlers();
}

registerDefaultHandlers();
