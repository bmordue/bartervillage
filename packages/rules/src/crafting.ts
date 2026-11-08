/**
 * Crafting and recipe gating (spec §6.2, M2.D08-M2.D12).
 *
 * Instant recipes resolve during the order phase. Timed recipes enter a
 * per-building FIFO queue: an idle building starts the first job immediately,
 * and later jobs start when the previous job completes. Inputs are locked when
 * the order resolves and consumed when the job starts.
 */

import type {
  Building,
  ContentPack,
  CraftJob,
  CraftPayload,
  ItemStack,
  RecipeDefinition,
  RecipeId,
  WorldState,
} from "./types.js";
import type { EventLog } from "./events.js";
import { isBuildingComplete } from "./buildings.js";
import { addItems, canAddItems, consumeLockedItems, lockItems, unlockItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import { orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

type EventfulContext = OrderExecutionContext & { events?: EventLog };

function contextEvents(context: OrderExecutionContext): EventLog | undefined {
  return (context as EventfulContext).events;
}

function compareBuildingIds(a: Building, b: Building): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function recipeById(content: ContentPack, recipeId: RecipeId): RecipeDefinition | undefined {
  return content.recipes.find((recipe) => recipe.id === recipeId);
}

function copyStacks(stacks: readonly ItemStack[]): ItemStack[] {
  return stacks.map((stack) => ({ item: stack.item, quantity: stack.quantity }));
}

/**
 * A recipe is available when it is unlocked by default or by a shared goal,
 * and the building has reached the recipe's required level (spec §6.2).
 */
export function isRecipeUnlocked(
  state: WorldState,
  content: ContentPack,
  recipeId: RecipeId,
  building: Building,
): boolean {
  const recipe = recipeById(content, recipeId);
  if (!recipe) {
    return false;
  }
  const unlocked = recipe.unlockedByDefault || state.unlockedRecipes.includes(recipeId);
  return unlocked && building.level >= recipe.buildingLevel;
}

function startJob(building: Building, recipe: RecipeDefinition, startedTick: number): CraftJob {
  const job: CraftJob = {
    recipeId: recipe.id,
    startedTick,
    completesTick: startedTick + recipe.durationTicks,
    inputs: copyStacks(recipe.inputs),
    outputs: copyStacks(recipe.outputs),
  };
  building.craftQueue.push(job);
  return job;
}

function handleCraft(context: OrderExecutionContext): OrderOutcome {
  const { state, content, player } = context;
  const payload = context.order.payload as CraftPayload;
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

  const recipe = recipeById(content, payload.recipeId);
  if (!recipe) {
    return orderFailed(`Unknown recipe ${payload.recipeId}`);
  }
  if (recipe.building !== building.type) {
    return orderFailed(`Recipe ${recipe.id} is not made at ${building.type}`);
  }
  if (building.level < recipe.buildingLevel) {
    return orderFailed(`${building.type} must be level ${recipe.buildingLevel} for ${recipe.id}`);
  }
  if (!isRecipeUnlocked(state, content, recipe.id, building)) {
    return orderFailed(`Recipe ${recipe.id} is not unlocked`);
  }

  const energyCost = orderEnergyCost(content, "craft");
  if (player.energy < energyCost) {
    return orderFailed(`Not enough energy to craft ${recipe.id}`);
  }

  if (recipe.durationTicks === 0) {
    // Capacity is checked before any mutation. Consuming the inputs frees
    // storage, so a successful check also guarantees the outputs fit.
    if (!canAddItems(state, content, plot.id, recipe.outputs)) {
      return orderFailed("Not enough storage capacity for the crafted goods");
    }
    const prelocked = context.preLockedItems;
    if (!prelocked && !lockItems(state, plot.id, recipe.inputs)) {
      return orderFailed(`Not enough free goods to craft ${recipe.id}`);
    }
    if (!spendEnergy(player, energyCost)) {
      if (!prelocked) {
        unlockItems(state, plot.id, recipe.inputs);
      }
      return orderFailed(`Not enough energy to craft ${recipe.id}`);
    }
    consumeLockedItems(state, plot.id, recipe.inputs);
    addItems(state, content, plot.id, recipe.outputs);

    const events = contextEvents(context);
    const completed = {
      buildingId: building.id,
      plotId: building.plotId,
      recipeId: recipe.id,
      completesTick: state.world.currentTick,
    };
    events?.emit("craft_started", completed);
    events?.emit("craft_completed", completed);
    return orderSucceeded;
  }

  const prelocked = context.preLockedItems;
  if (!prelocked && !lockItems(state, plot.id, recipe.inputs)) {
    return orderFailed(`Not enough free goods to craft ${recipe.id}`);
  }
  if (!spendEnergy(player, energyCost)) {
    if (!prelocked) {
      unlockItems(state, plot.id, recipe.inputs);
    }
    return orderFailed(`Not enough energy to craft ${recipe.id}`);
  }

  const now = state.world.currentTick;
  const job = startJob(building, recipe, now);
  if (building.craftQueue.length > 1) {
    // Queued behind existing work: keep the inputs locked until the job starts.
    job.completesTick = now + recipe.durationTicks;
  } else {
    // Idle building: the job starts immediately, so its inputs are consumed now.
    consumeLockedItems(state, plot.id, recipe.inputs);
  }

  contextEvents(context)?.emit("craft_started", {
    buildingId: building.id,
    plotId: building.plotId,
    recipeId: recipe.id,
    completesTick: job.completesTick,
  });
  return orderSucceeded;
}

/**
 * Advance each building's FIFO craft queue (spec §14.4e).
 *
 * Jobs that reach their completion tick are removed only when their outputs
 * fit. If storage is full the job stays at the front with its completion tick
 * unchanged and is retried on a later tick; later jobs cannot start until the
 * blocked job has been collected.
 */
export function advanceCrafting(state: WorldState, content: ContentPack, events: EventLog): void {
  const currentTick = state.world.currentTick;
  const buildings = [...state.buildings].sort(compareBuildingIds);

  for (const building of buildings) {
    while (building.craftQueue.length > 0) {
      const job = building.craftQueue[0];
      if (!job || job.completesTick > currentTick) {
        break;
      }

      if (!canAddItems(state, content, building.plotId, job.outputs)) {
        break;
      }

      addItems(state, content, building.plotId, job.outputs);
      const completedTick = job.completesTick;
      building.craftQueue.shift();
      events.emit("craft_completed", {
        buildingId: building.id,
        plotId: building.plotId,
        recipeId: job.recipeId,
        completesTick: completedTick,
      });

      const next = building.craftQueue[0];
      if (!next) {
        break;
      }
      const recipe = recipeById(content, next.recipeId);
      const duration = recipe ? recipe.durationTicks : next.completesTick - next.startedTick;
      if (!consumeLockedItems(state, building.plotId, next.inputs)) {
        // The queued job cannot start without its locked inputs. Leave it in
        // place rather than silently dropping goods from the queue.
        break;
      }
      next.startedTick = completedTick;
      next.completesTick = completedTick + duration;
    }
  }
}

export function registerCraftingHandlers(): void {
  registerOrderHandler("craft", handleCraft);
}
