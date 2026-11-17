/**
 * Server-side order re-validation (spec §12, §14.5; M4.B03).
 *
 * The client may run light pre-checks, but the server is authoritative. Before
 * an order is queued (or a queue edit is accepted), the server re-validates the
 * order against the current world state: energy, free inventory, capacity,
 * locks, location, building requirements and offer state.
 */

import type { ContentPack } from "@bartervillage/rules";
import {
  heldQuantity,
  orderEnergyCost,
  plotOfPlayer,
  resolveOrder,
  getOrderHandler,
  type OrderExecutionContext,
  type WorldState,
  type Order,
  type Player,
  type ItemStack,
} from "@bartervillage/rules";
import {
  canAddItems,
  canLockItems,
  registerAnimalHandlers,
  registerBarterHandlers,
  registerBuildingHandlers,
  registerCraftingHandlers,
  registerDecorationHandlers,
  registerDefaultHandlers,
  registerForageHandlers,
  registerHelpHandlers,
} from "@bartervillage/rules";

// Register every rules handler so that dry-run validation exercises the real
// handlers for each order type.
registerAnimalHandlers();
registerBarterHandlers();
registerBuildingHandlers();
registerCraftingHandlers();
registerDecorationHandlers();
registerDefaultHandlers();
registerForageHandlers();
registerHelpHandlers();

export interface OrderValidationResult {
  ok: boolean;
  reason: string | null;
}

function fail(reason: string): OrderValidationResult {
  return { ok: false, reason };
}

function ok(): OrderValidationResult {
  return { ok: true, reason: null };
}

/**
 * Find a building by its id in the current world state.
 */
function buildingById(
  state: WorldState,
  id: string,
):
  | {
      plotId: string;
      type: string;
      level: number;
      constructionKind: string | null;
      constructionCompleteTick: number | null;
    }
  | undefined {
  return state.buildings.find((building) => building.id === id);
}

/**
 * Re-validate an order against the current state without mutating anything.
 *
 * The validation mirrors the preconditions the rules engine enforces at
 * resolution time, but runs at queue time so the player gets immediate,
 * authoritative feedback and the tick cannot be surprised by a guaranteed
 * failure.
 */
export function validateOrderServerSide(
  state: WorldState,
  content: ContentPack,
  order: Order,
): OrderValidationResult {
  const player = state.players.find((candidate) => candidate.id === order.playerId);
  if (!player) {
    return fail(`Unknown player ${order.playerId}`);
  }

  const plot = plotOfPlayer(state, order.playerId);
  if (!plot) {
    return fail(`Player ${order.playerId} has no plot`);
  }

  const energyCost = orderEnergyCost(content, order.type);
  if (player.energy < energyCost) {
    return fail(`Not enough energy for ${order.type} (needs ${energyCost})`);
  }

  const buildingReq = buildingRequirementFor(state, content, order, plot.id);
  if (buildingReq) {
    return fail(buildingReq);
  }

  const lockReq = lockRequirementFor(state, content, order, plot.id);
  if (lockReq) {
    return fail(lockReq);
  }

  const locationReq = locationRequirementFor(state, order);
  if (locationReq) {
    return fail(locationReq);
  }

  const offerReq = offerRequirementFor(state, order);
  if (offerReq) {
    return fail(offerReq);
  }

  const capacityReq = capacityRequirementFor(state, content, order, plot.id);
  if (capacityReq) {
    return fail(capacityReq);
  }

  // Run the actual handler on a cloned state to catch any remaining precondition
  // the handler enforces (e.g. consumption of goods, emission of events). This is
  // safe because we clone the whole state tree.
  const dryRun = dryRunOrder(state, content, order, player);
  if (!dryRun.ok) {
    return fail(dryRun.reason ?? `Order ${order.type} would fail at resolution`);
  }

  return ok();
}

function buildingRequirementFor(
  state: WorldState,
  content: ContentPack,
  order: Order,
  plotId: string,
): string | null {
  if (order.type === "craft") {
    const payload = order.payload as { recipeId: string; buildingId?: string };
    const recipe = content.recipes.find((entry) => entry.id === payload.recipeId);
    if (!recipe) {
      return `Unknown recipe ${payload.recipeId}`;
    }
    const buildingId = payload.buildingId;
    if (!buildingId) {
      return "Missing buildingId for craft order";
    }
    const building = buildingById(state, buildingId);
    if (!building) {
      return `Unknown building ${buildingId}`;
    }
    if (building.plotId !== plotId) {
      return `Building ${buildingId} is not on your plot`;
    }
    if (!isBuildingComplete(building)) {
      return "Building is not complete";
    }
    if (building.type !== recipe.building) {
      return `Recipe ${recipe.id} is not made at ${building.type}`;
    }
    if (building.level < recipe.buildingLevel) {
      return `${building.type} must be level ${recipe.buildingLevel} for ${recipe.id}`;
    }
    if (!isRecipeUnlocked(state, content, recipe.id, building)) {
      return `Recipe ${recipe.id} is not unlocked`;
    }
    if (recipe.durationTicks === 0) {
      if (!canAddItems(state, content, plotId, recipe.outputs)) {
        return "Not enough storage capacity for the crafted goods";
      }
    }
  }
  if (order.type === "upgrade" || order.type === "build") {
    const payload = order.payload as { building?: string; buildingId?: string };
    if (payload.buildingId !== undefined) {
      const building = buildingById(state, payload.buildingId);
      if (!building) {
        return `Unknown building ${payload.buildingId}`;
      }
      if (building.plotId !== plotId) {
        return `Building ${payload.buildingId} is not on your plot`;
      }
      if (!isBuildingComplete(building)) {
        return "Building is not complete";
      }
    }
    if (order.type === "build") {
      const definition = content.buildings.find((entry) => entry.id === payload.building);
      const level = definition?.levels.find((entry) => entry.level === 1);
      if (!level) {
        return `Unknown building type ${payload.building}`;
      }
    }
    if (order.type === "upgrade") {
      const building = buildingById(state, payload.buildingId!);
      const definition = building
        ? content.buildings.find((entry) => entry.id === building.type)
        : undefined;
      const level =
        building && definition
          ? definition.levels.find((entry) => entry.level === building.level + 1)
          : undefined;
      if (!level) {
        return "Cannot upgrade building further";
      }
    }
  }
  return null;
}

function isBuildingComplete(building: {
  constructionKind: string | null;
  constructionCompleteTick: number | null;
}): boolean {
  return building.constructionKind === null;
}

function isRecipeUnlocked(
  state: WorldState,
  content: ContentPack,
  recipeId: string,
  building: { type: string; level: number },
): boolean {
  const recipe = content.recipes.find((entry) => entry.id === recipeId);
  if (!recipe) {
    return false;
  }
  const unlocked = recipe.unlockedByDefault || state.unlockedRecipes.includes(recipeId);
  return unlocked && building.level >= recipe.buildingLevel;
}

function lockRequirementFor(
  state: WorldState,
  content: ContentPack,
  order: Order,
  plotId: string,
): string | null {
  const items = lockedItemsFor(state, content, order);
  if (items.length === 0) {
    return null;
  }
  for (const stack of items) {
    if (heldQuantity(state, plotId, stack.item) < stack.quantity) {
      return `Not enough ${stack.item} to lock for ${order.type}`;
    }
  }
  if (!canLockItems(state, plotId, items)) {
    return `Not enough free goods to lock for ${order.type}`;
  }
  return null;
}

function lockedItemsFor(state: WorldState, content: ContentPack, order: Order): ItemStack[] {
  if (order.type === "build") {
    const payload = order.payload as { building: string };
    const definition = content.buildings.find((entry) => entry.id === payload.building);
    const level = definition?.levels.find((entry) => entry.level === 1);
    return level ? [...level.cost] : [];
  }
  if (order.type === "upgrade") {
    const payload = order.payload as { buildingId: string };
    const building = buildingById(state, payload.buildingId);
    const definition = building
      ? content.buildings.find((entry) => entry.id === building.type)
      : undefined;
    const level =
      building && definition
        ? definition.levels.find((entry) => entry.level === building.level + 1)
        : undefined;
    return level ? [...level.cost] : [];
  }
  if (order.type === "craft") {
    const payload = order.payload as { recipeId: string };
    const recipe = content.recipes.find((entry) => entry.id === payload.recipeId);
    return recipe ? [...recipe.inputs] : [];
  }
  if (order.type === "post_offer") {
    const payload = order.payload as { gives: { item: string; quantity: number }[] };
    return [...payload.gives];
  }
  if (order.type === "counter_offer") {
    const payload = order.payload as { gives: { item: string; quantity: number }[] };
    return [...payload.gives];
  }
  if (order.type === "accept_offer") {
    const payload = order.payload as { offerId: string };
    const offer = state.offers.find((entry) => entry.id === payload.offerId);
    return offer ? [...offer.wants] : [];
  }
  if (order.type === "contribute_goal") {
    const payload = order.payload as { items: { item: string; quantity: number }[] };
    return [...payload.items];
  }
  if (order.type === "gift") {
    const payload = order.payload as { items: { item: string; quantity: number }[] };
    return [...payload.items];
  }
  return [];
}

function locationRequirementFor(state: WorldState, order: Order): string | null {
  if (order.type === "forage" || order.type === "fish") {
    const payload = order.payload as { nodeId?: string; buildingId?: string };
    if (payload.nodeId !== undefined) {
      const node = state.wildNodes.find((candidate) => candidate.id === payload.nodeId);
      if (!node) {
        return `Unknown wild node ${payload.nodeId}`;
      }
      const plot = plotOfPlayer(state, order.playerId);
      if (!plot || plot.regionId !== node.regionId) {
        return `Player is not in region ${node.regionId}`;
      }
    }
    if (payload.buildingId !== undefined) {
      const building = state.buildings.find((candidate) => candidate.id === payload.buildingId);
      if (!building) {
        return `Unknown building ${payload.buildingId}`;
      }
      const plot = plotOfPlayer(state, order.playerId);
      if (!plot || building.plotId !== plot.id) {
        return "Dock is not on your plot";
      }
    }
  }
  return null;
}

function offerRequirementFor(state: WorldState, order: Order): string | null {
  if (order.type === "accept_offer") {
    const payload = order.payload as { offerId: string };
    const offer = state.offers.find((candidate) => candidate.id === payload.offerId);
    if (!offer) {
      return `Unknown offer ${payload.offerId}`;
    }
    if (offer.posterId === order.playerId) {
      return "Cannot accept your own post";
    }
    if (offer.status !== "open") {
      return `Offer ${payload.offerId} is not open`;
    }
  }
  if (order.type === "counter_offer") {
    const payload = order.payload as { parentOfferId: string };
    const parentOfferId = payload.parentOfferId;
    const parent = state.offers.find((candidate) => candidate.id === parentOfferId);
    if (!parent) {
      return `Unknown parent offer ${parentOfferId}`;
    }
    if (parent.posterId === order.playerId) {
      return "Cannot counter your own post";
    }
    if (parent.status !== "open") {
      return `Parent offer ${parentOfferId} is not open`;
    }
  }
  if (order.type === "cancel_offer") {
    const payload = order.payload as { offerId: string };
    const offer = state.offers.find((candidate) => candidate.id === payload.offerId);
    if (!offer) {
      return `Unknown offer ${payload.offerId}`;
    }
    if (offer.posterId !== order.playerId) {
      return `Offer ${payload.offerId} was not posted by this player`;
    }
  }
  return null;
}

function capacityRequirementFor(
  state: WorldState,
  content: ContentPack,
  order: Order,
  plotId: string,
): string | null {
  if (order.type === "forage" || order.type === "fish") {
    const free = freeCapacityFor(state, content, plotId);
    if (free <= 0) {
      return "No free storage for the claim";
    }
  }
  return null;
}

function freeCapacityFor(state: WorldState, content: ContentPack, plotId: string): number {
  const capacity = plotCapacityFor(state, content, plotId);
  const used = usedCapacityFor(state, plotId);
  return Math.max(0, capacity - used);
}

function plotCapacityFor(state: WorldState, content: ContentPack, plotId: string): number {
  const storehouse = state.buildings.find(
    (building) => building.plotId === plotId && building.type === "storehouse",
  );
  if (!storehouse) {
    return 0;
  }
  const definition = content.buildings.find((entry) => entry.id === "storehouse");
  const level = definition?.levels.find((entry) => entry.level === storehouse.level);
  return level ? level.storageCapacity : 0;
}

function usedCapacityFor(state: WorldState, plotId: string): number {
  return state.inventory
    .filter((row) => row.plotId === plotId)
    .reduce((total, row) => total + row.quantity, 0);
}

/**
 * Run the order handler against a cloned state to catch any remaining precondition
 * the handler enforces (e.g. consumption of goods, emission of events). This is safe
 * because we clone the whole state tree.
 */
function dryRunOrder(
  state: WorldState,
  content: ContentPack,
  order: Order,
  player: Player,
): OrderValidationResult {
  if (!getOrderHandler(order.type)) {
    // Order types without a registered handler (e.g. not yet implemented) are
    // validated by the explicit checks above only.
    return ok();
  }
  const clone = structuredClone(state);
  const clonedPlayer = clone.players.find((candidate) => candidate.id === player.id);
  if (!clonedPlayer) {
    return fail(`Player ${player.id} not found in cloned state`);
  }
  const context: OrderExecutionContext = {
    state: clone,
    content,
    order,
    player: clonedPlayer,
    location: { regionId: plotOfPlayer(clone, player.id)?.regionId ?? "" },
    reachable: new Set(),
    path: [],
  };
  const outcome = resolveOrder(context);
  if (!outcome.ok) {
    return fail(outcome.reason ?? `Order ${order.type} would fail at resolution`);
  }
  return ok();
}
