/**
 * Lookups, region geometry, travel costs and energy helpers (spec §4.3, §5).
 */

import type {
  Building,
  BuildingDefinition,
  BuildingTypeId,
  ContentPack,
  Crop,
  InventoryRow,
  ItemId,
  ItemStack,
  OrderType,
  Player,
  PlayerId,
  Plot,
  PlotId,
  Region,
  RegionId,
  WorldState,
} from "./types.js";

export function playerById(state: WorldState, playerId: PlayerId): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function plotById(state: WorldState, plotId: PlotId): Plot | undefined {
  return state.plots.find((plot) => plot.id === plotId);
}

export function plotOfPlayer(state: WorldState, playerId: PlayerId): Plot | undefined {
  return state.plots.find((plot) => plot.playerId === playerId);
}

export function regionById(state: WorldState, regionId: RegionId): Region | undefined {
  return state.regions.find((region) => region.id === regionId);
}

export function regionDistance(a: Region, b: Region): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function travelCostBetween(
  state: WorldState,
  content: ContentPack,
  fromRegionId: RegionId,
  toRegionId: RegionId,
): number {
  if (fromRegionId === toRegionId) {
    return 0;
  }
  const from = regionById(state, fromRegionId);
  const to = regionById(state, toRegionId);
  if (!from || !to) {
    return Number.POSITIVE_INFINITY;
  }
  return regionDistance(from, to) * content.energy.travelPerBoundary;
}

export function buildingsOfPlot(state: WorldState, plotId: PlotId): Building[] {
  return state.buildings.filter((building) => building.plotId === plotId);
}

export function hasBuilding(
  state: WorldState,
  plotId: PlotId,
  type: BuildingTypeId,
): Building | undefined {
  return state.buildings.find((building) => building.plotId === plotId && building.type === type);
}

export function buildingDefinition(
  content: ContentPack,
  type: BuildingTypeId,
): BuildingDefinition | undefined {
  return content.buildings.find((building) => building.id === type);
}

export function buildingLevelDefinition(
  content: ContentPack,
  building: Building,
): BuildingDefinition["levels"][number] | undefined {
  const definition = buildingDefinition(content, building.type);
  return definition?.levels.find((level) => level.level === building.level);
}

/** Total storage capacity of a plot from all storage-bearing buildings. */
export function plotCapacity(state: WorldState, content: ContentPack, plotId: PlotId): number {
  return buildingsOfPlot(state, plotId).reduce((total, building) => {
    const level = buildingLevelDefinition(content, building);
    return total + (level?.storageCapacity ?? 0);
  }, 0);
}

export function cropAtTile(
  state: WorldState,
  plotId: PlotId,
  x: number,
  y: number,
): Crop | undefined {
  return state.crops.find((crop) => crop.plotId === plotId && crop.tileX === x && crop.tileY === y);
}

export function inventoryRow(
  state: WorldState,
  plotId: PlotId,
  item: ItemId,
): InventoryRow | undefined {
  return state.inventory.find((row) => row.plotId === plotId && row.item === item);
}

export function heldQuantity(state: WorldState, plotId: PlotId, item: ItemId): number {
  return inventoryRow(state, plotId, item)?.quantity ?? 0;
}

export function lockedQuantity(state: WorldState, plotId: PlotId, item: ItemId): number {
  return inventoryRow(state, plotId, item)?.locked ?? 0;
}

export function freeQuantity(state: WorldState, plotId: PlotId, item: ItemId): number {
  return heldQuantity(state, plotId, item) - lockedQuantity(state, plotId, item);
}

export function usedCapacity(state: WorldState, plotId: PlotId): number {
  return state.inventory
    .filter((row) => row.plotId === plotId)
    .reduce((total, row) => total + row.quantity, 0);
}

export function freeCapacity(state: WorldState, content: ContentPack, plotId: PlotId): number {
  return Math.max(0, plotCapacity(state, content, plotId) - usedCapacity(state, plotId));
}

export function itemDef(content: ContentPack, item: ItemId): { name: string } | undefined {
  return content.items[item];
}

export function spendEnergy(player: Player, amount: number): boolean {
  if (!Number.isInteger(amount) || amount < 0) {
    return false;
  }
  if (player.energy < amount) {
    return false;
  }
  player.energy -= amount;
  return true;
}

export function refreshEnergy(state: WorldState, content: ContentPack): void {
  for (const player of state.players) {
    player.energy = content.energy.dailyBudget;
  }
}

export function orderEnergyCost(content: ContentPack, type: OrderType): number {
  return content.energy.costs[type] ?? 0;
}

export function totalQuantity(stacks: readonly ItemStack[]): number {
  return stacks.reduce((total, stack) => total + stack.quantity, 0);
}
