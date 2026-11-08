/**
 * Crop order handlers and lifecycle rules (spec §6.2, §9; M2.B01-M2.B08).
 */

import type { EventLog } from "./events.js";
import { addItems, canAddItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
} from "./orders.js";
import type { Rng } from "./rng.js";
import type {
  ContentPack,
  Crop,
  CropDefinition,
  CropTypeId,
  OrderPayloadMap,
  Season,
  Weather,
  WeatherDefinition,
  WorldState,
} from "./types.js";
import { cropAtTile, orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

type CropOrderContext = OrderExecutionContext & { events?: EventLog };

function cropDefinition(content: ContentPack, crop: CropTypeId): CropDefinition | undefined {
  return content.crops.find((definition) => definition.id === crop);
}

function weatherDefinition(content: ContentPack, weather: Weather): WeatherDefinition | undefined {
  return content.weather.find((definition) => definition.id === weather);
}

function ownCrop(
  context: OrderExecutionContext,
  tile: { x: number; y: number },
): { crop: Crop; definition: CropDefinition } | string {
  const plot = plotOfPlayer(context.state, context.player.id);
  if (!plot) {
    return "Player has no plot";
  }
  if (
    !Number.isInteger(tile.x) ||
    !Number.isInteger(tile.y) ||
    tile.x < 0 ||
    tile.y < 0 ||
    tile.x >= plot.width ||
    tile.y >= plot.height
  ) {
    return "Tile is outside the player's plot";
  }
  const crop = cropAtTile(context.state, plot.id, tile.x, tile.y);
  if (!crop) {
    return "No crop on that tile";
  }
  const definition = cropDefinition(context.content, crop.type);
  if (!definition) {
    return `Unknown crop type ${crop.type}`;
  }
  return { crop, definition };
}

function plantHandler(context: OrderExecutionContext) {
  const payload = context.order.payload as OrderPayloadMap["plant"];
  const plot = plotOfPlayer(context.state, context.player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }
  const definition = cropDefinition(context.content, payload.crop);
  if (!definition) {
    return orderFailed(`Unknown crop type ${payload.crop}`);
  }
  if (!definition.unlockedByDefault && !context.state.unlockedCrops.includes(definition.id)) {
    return orderFailed(`Crop ${definition.id} is not unlocked`);
  }
  if (!definition.seasons.includes(context.state.world.season)) {
    return orderFailed(`Crop ${definition.id} cannot grow in ${context.state.world.season}`);
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
  const cost = orderEnergyCost(context.content, "plant");
  if (context.player.energy < cost) {
    return orderFailed(`Not enough energy to plant (needs ${cost})`);
  }
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to plant (needs ${cost})`);
  }
  context.state.crops.push({
    id: `crop:${context.order.id}`,
    plotId: plot.id,
    tileX: x,
    tileY: y,
    type: definition.id,
    plantedTick: context.state.world.currentTick,
    growthTicks: definition.growthTicks,
    watered: false,
    tended: false,
    failed: false,
  });
  return orderSucceeded;
}

function tendHandler(context: OrderExecutionContext) {
  const payload = context.order.payload as OrderPayloadMap["tend"];
  const result = ownCrop(context, payload.tile);
  if (typeof result === "string") {
    return orderFailed(result);
  }
  if (result.crop.failed) {
    return orderFailed("Crop has failed");
  }
  const cost = orderEnergyCost(context.content, "tend");
  if (context.player.energy < cost) {
    return orderFailed(`Not enough energy to tend (needs ${cost})`);
  }
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to tend (needs ${cost})`);
  }
  if (!result.crop.watered) {
    result.crop.watered = true;
  } else {
    result.crop.tended = true;
  }
  return orderSucceeded;
}

function harvestHandler(context: CropOrderContext) {
  const payload = context.order.payload as OrderPayloadMap["harvest"];
  const result = ownCrop(context, payload.tile);
  if (typeof result === "string") {
    return orderFailed(result);
  }
  const { crop, definition } = result;
  if (crop.failed) {
    return orderFailed("Crop has failed");
  }
  if (context.state.world.currentTick < crop.plantedTick + crop.growthTicks) {
    return orderFailed("Crop is not ripe yet");
  }
  const plot = plotOfPlayer(context.state, context.player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }
  if (!canAddItems(context.state, context.content, plot.id, definition.yield)) {
    return orderFailed("Not enough storage capacity for the harvest");
  }
  const cost = orderEnergyCost(context.content, "harvest");
  if (context.player.energy < cost) {
    return orderFailed(`Not enough energy to harvest (needs ${cost})`);
  }
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to harvest (needs ${cost})`);
  }
  addItems(context.state, context.content, plot.id, definition.yield);
  context.state.crops = context.state.crops.filter((candidate) => candidate !== crop);
  context.events?.emit("crop_grown", {
    cropId: crop.id,
    plotId: crop.plotId,
    tile: { x: crop.tileX, y: crop.tileY },
    cropType: crop.type,
  });
  return orderSucceeded;
}

export function registerCropHandlers(): void {
  registerOrderHandler("plant", plantHandler);
  registerOrderHandler("harvest", harvestHandler);
  registerOrderHandler("tend", tendHandler);
}

registerCropHandlers();

export function advanceCrops(
  state: WorldState,
  content: ContentPack,
  rng: Rng,
  events: EventLog,
): void {
  const weather = weatherDefinition(content, state.world.weather);
  const countsAsWatering = weather?.countsAsWatering ?? false;
  const failureChance = weather?.failureChance ?? 0;
  const frostDamage = weather?.frostDamage ?? false;

  for (const crop of state.crops) {
    if (crop.failed) {
      continue;
    }
    const definition = cropDefinition(content, crop.type);
    if (!definition) {
      continue;
    }
    if (crop.plantedTick >= state.world.currentTick) {
      continue;
    }

    const ripeTick = crop.plantedTick + crop.growthTicks;
    if (state.world.currentTick <= ripeTick) {
      const weatherFailure =
        (frostDamage && definition.frostSensitive) || rng.chance(failureChance);
      if (weatherFailure) {
        crop.failed = true;
        const reason = `weather:${state.world.weather}`;
        events.emit("crop_failed", {
          cropId: crop.id,
          plotId: crop.plotId,
          tile: { x: crop.tileX, y: crop.tileY },
          reason,
        });
        events.emit("blight", {
          plotId: crop.plotId,
          tile: { x: crop.tileX, y: crop.tileY },
          reason,
        });
        crop.watered = false;
        crop.tended = false;
        continue;
      }
      if (definition.wateringRequired && !crop.watered && !countsAsWatering) {
        crop.failed = true;
        events.emit("crop_failed", {
          cropId: crop.id,
          plotId: crop.plotId,
          tile: { x: crop.tileX, y: crop.tileY },
          reason: "not watered",
        });
        crop.watered = false;
        crop.tended = false;
        continue;
      }
      if (definition.tendingRequired && !crop.tended) {
        crop.failed = true;
        events.emit("crop_failed", {
          cropId: crop.id,
          plotId: crop.plotId,
          tile: { x: crop.tileX, y: crop.tileY },
          reason: "not tended",
        });
        crop.watered = false;
        crop.tended = false;
        continue;
      }
    }

    crop.watered = false;
    crop.tended = false;
  }
}

export function witherOutOfSeason(
  state: WorldState,
  content: ContentPack,
  season: Season,
  events: EventLog,
): void {
  const survivors: Crop[] = [];
  for (const crop of state.crops) {
    const definition = cropDefinition(content, crop.type);
    if (definition && definition.seasons.includes(season)) {
      survivors.push(crop);
      continue;
    }
    events.emit("crop_withered", {
      cropId: crop.id,
      plotId: crop.plotId,
      tile: { x: crop.tileX, y: crop.tileY },
      reason: `cannot grow in ${season}`,
    });
  }
  state.crops = survivors;
}
