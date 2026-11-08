/**
 * Buildings and construction (spec §6.1, M2.D01-M2.D05).
 *
 * A build order creates a level-0 building while construction is in progress;
 * the building becomes level 1 when the world update completes it. Timed
 * upgrades keep the old level until completion. Construction inputs are locked
 * when the order resolves and consumed when the work completes.
 */

import type {
  Building,
  BuildingDefinition,
  BuildingLevelDefinition,
  BuildPayload,
  ConstructionKind,
  ContentPack,
  Plot,
  UpgradePayload,
  WorldState,
} from "./types.js";
import type { EventLog } from "./events.js";
import { consumeLockedItems, lockItems, unlockItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import {
  buildingDefinition,
  buildingsOfPlot,
  hasBuilding,
  plotOfPlayer,
  spendEnergy,
} from "./world.js";

type EventfulContext = OrderExecutionContext & { events?: EventLog };

function contextEvents(context: OrderExecutionContext): EventLog | undefined {
  return (context as EventfulContext).events;
}

function compareBuildingIds(a: Building, b: Building): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function levelDefinition(
  definition: BuildingDefinition,
  level: number,
): BuildingLevelDefinition | undefined {
  return definition.levels.find((candidate) => candidate.level === level);
}

function plotBiome(state: WorldState, plot: Plot): string | null {
  const tile = state.tiles.find(
    (candidate) =>
      candidate.regionId === plot.regionId &&
      candidate.x === plot.siteX &&
      candidate.y === plot.siteY,
  );
  return tile?.biome ?? null;
}

function nextBuildingId(state: WorldState, plotId: string, type: string): string {
  const base = `building-${plotId}-${type}`;
  if (!state.buildings.some((building) => building.id === base)) {
    return base;
  }
  let suffix = 2;
  while (state.buildings.some((building) => building.id === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * A building can be used for storage, recipes and capacity only when it is not
 * under construction or upgrade. Level 0 is always a build in progress.
 */
export function isBuildingComplete(building: Building): boolean {
  return building.constructionKind === null && building.level >= 1;
}

function emitConstruction(
  context: OrderExecutionContext,
  type: "construction_started" | "construction_completed",
  building: Building,
  kind: ConstructionKind,
  completesTick: number,
): void {
  contextEvents(context)?.emit(type, {
    buildingId: building.id,
    plotId: building.plotId,
    buildingType: building.type,
    kind,
    completesTick,
  });
}

function handleBuild(context: OrderExecutionContext): OrderOutcome {
  const { state, content, player } = context;
  const payload = context.order.payload as BuildPayload;
  const plot = plotOfPlayer(state, player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }

  const definition = buildingDefinition(content, payload.building);
  if (!definition) {
    return orderFailed(`Unknown building ${payload.building}`);
  }

  if (definition.biomeLocks !== null) {
    const biome = plotBiome(state, plot);
    if (biome === null) {
      return orderFailed(`Cannot determine the biome of plot ${plot.id}`);
    }
    if (!definition.biomeLocks.includes(biome)) {
      return orderFailed(`${payload.building} cannot be built in biome ${biome}`);
    }
  }

  if (hasBuilding(state, plot.id, payload.building)) {
    return orderFailed(`${payload.building} already exists on this plot`);
  }

  const construction = buildingsOfPlot(state, plot.id).find(
    (building) => building.constructionKind !== null,
  );
  if (construction) {
    return orderFailed("Another construction is already in progress on this plot");
  }

  const level = levelDefinition(definition, 1);
  if (!level) {
    return orderFailed(`${payload.building} has no level 1 definition`);
  }

  if (player.energy < level.energyCost) {
    return orderFailed(`Not enough energy to build ${payload.building}`);
  }
  if (!lockItems(state, plot.id, level.cost)) {
    return orderFailed(`Not enough free goods to build ${payload.building}`);
  }
  if (!spendEnergy(player, level.energyCost)) {
    unlockItems(state, plot.id, level.cost);
    return orderFailed(`Not enough energy to build ${payload.building}`);
  }

  const duration = level.durationTicks;
  const completesTick = state.world.currentTick + duration;
  const building: Building = {
    id: nextBuildingId(state, plot.id, payload.building),
    plotId: plot.id,
    type: payload.building,
    level: duration > 0 ? 0 : 1,
    constructionKind: duration > 0 ? "build" : null,
    constructionCompleteTick: duration > 0 ? completesTick : null,
    craftQueue: [],
  };
  state.buildings.push(building);

  if (duration === 0) {
    consumeLockedItems(state, plot.id, level.cost);
  }

  emitConstruction(context, "construction_started", building, "build", completesTick);
  if (duration === 0) {
    emitConstruction(context, "construction_completed", building, "build", completesTick);
  }
  return orderSucceeded;
}

function handleUpgrade(context: OrderExecutionContext): OrderOutcome {
  const { state, content, player } = context;
  const payload = context.order.payload as UpgradePayload;
  const plot = plotOfPlayer(state, player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }

  const building = state.buildings.find((candidate) => candidate.id === payload.buildingId);
  if (!building) {
    return orderFailed(`Unknown building ${payload.buildingId}`);
  }
  if (building.plotId !== plot.id) {
    return orderFailed("Building is not on your plot");
  }
  if (!isBuildingComplete(building)) {
    return orderFailed("Building is not complete");
  }
  if (building.constructionKind !== null) {
    return orderFailed("Building already has construction in progress");
  }

  const definition = buildingDefinition(content, building.type);
  if (!definition) {
    return orderFailed(`Unknown building type ${building.type}`);
  }
  if (building.level >= definition.maxLevel) {
    return orderFailed(`${building.type} is already at its maximum level`);
  }

  const nextLevel = levelDefinition(definition, building.level + 1);
  if (!nextLevel) {
    return orderFailed(`${building.type} has no level ${building.level + 1} definition`);
  }

  if (player.energy < nextLevel.energyCost) {
    return orderFailed(`Not enough energy to upgrade ${building.type}`);
  }
  if (!lockItems(state, plot.id, nextLevel.cost)) {
    return orderFailed(`Not enough free goods to upgrade ${building.type}`);
  }
  if (!spendEnergy(player, nextLevel.energyCost)) {
    unlockItems(state, plot.id, nextLevel.cost);
    return orderFailed(`Not enough energy to upgrade ${building.type}`);
  }

  const duration = nextLevel.durationTicks;
  const completesTick = state.world.currentTick + duration;
  if (duration === 0) {
    consumeLockedItems(state, plot.id, nextLevel.cost);
    building.level += 1;
  } else {
    building.constructionKind = "upgrade";
    building.constructionCompleteTick = completesTick;
  }

  emitConstruction(context, "construction_started", building, "upgrade", completesTick);
  if (duration === 0) {
    emitConstruction(context, "construction_completed", building, "upgrade", completesTick);
  }
  return orderSucceeded;
}

/**
 * Complete construction and upgrades whose scheduled tick has arrived. Call
 * this from the world update before the player order phase (spec §14.4e).
 */
export function advanceConstruction(
  state: WorldState,
  content: ContentPack,
  events: EventLog,
): void {
  const currentTick = state.world.currentTick;
  const due = state.buildings
    .filter(
      (building) =>
        building.constructionKind !== null &&
        building.constructionCompleteTick !== null &&
        building.constructionCompleteTick <= currentTick,
    )
    .sort(compareBuildingIds);

  for (const building of due) {
    const kind = building.constructionKind;
    const completesTick = building.constructionCompleteTick;
    if (kind === null || completesTick === null) {
      continue;
    }

    const definition = buildingDefinition(content, building.type);
    if (!definition) {
      continue;
    }

    const targetLevel = kind === "build" ? 1 : building.level + 1;
    const level = levelDefinition(definition, targetLevel);
    if (!level) {
      continue;
    }
    if (!consumeLockedItems(state, building.plotId, level.cost)) {
      continue;
    }

    building.level = targetLevel;
    building.constructionKind = null;
    building.constructionCompleteTick = null;
    events.emit("construction_completed", {
      buildingId: building.id,
      plotId: building.plotId,
      buildingType: building.type,
      kind,
      completesTick,
    });
  }
}

export function registerBuildingHandlers(): void {
  registerOrderHandler("build", handleBuild);
  registerOrderHandler("upgrade", handleUpgrade);
}
