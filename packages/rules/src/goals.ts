/**
 * Shared goals and contributions (spec §9; M7.05).
 *
 * Collective builds and seasonal festivals share one model: a goal lists the
 * goods the group must contribute before its deadline. Contributions lock when
 * the order is queued, stay locked while the goal is active, are consumed only
 * if the goal succeeds, and are released if it expires.
 */

import type { EventLog } from "./events.js";
import { consumeLockedItems, lockItems, unlockItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import type {
  ContentPack,
  Contribution,
  ContributeGoalPayload,
  Goal,
  GoalCompletedPayload,
  GoalDefinition,
  GoalId,
  GoalProgressPayload,
  GoalStatus,
  ItemId,
  ItemStack,
  Tick,
  WorldState,
} from "./types.js";
import { orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

export interface GoalProgressEntry {
  item: ItemId;
  required: number;
  contributed: number;
  remaining: number;
}

export interface GoalProgress {
  goalId: GoalId;
  entries: GoalProgressEntry[];
  complete: boolean;
}

type EventfulContext = OrderExecutionContext & { events?: EventLog };

function contextEvents(context: OrderExecutionContext): EventLog | undefined {
  return (context as EventfulContext).events;
}

function copyStacks(stacks: readonly ItemStack[]): ItemStack[] {
  return stacks.map((stack) => ({ item: stack.item, quantity: stack.quantity }));
}

function mergeStacks(stacks: readonly ItemStack[]): Map<ItemId, number> {
  const merged = new Map<ItemId, number>();
  for (const stack of stacks) {
    merged.set(stack.item, (merged.get(stack.item) ?? 0) + stack.quantity);
  }
  return merged;
}

export function createGoal(definition: GoalDefinition, createdAtTick: Tick): Goal {
  return {
    id: definition.id,
    kind: definition.kind,
    title: definition.title,
    requires: copyStacks(definition.requires),
    rewards: definition.rewards.map((reward) => ({ ...reward })),
    createdAtTick,
    deadlineTick: createdAtTick + definition.durationTicks,
    status: "active",
  };
}

/** Pick the next unused definition, but never while a goal is active. */
export function nextGoalDefinition(
  state: WorldState,
  content: ContentPack,
): GoalDefinition | undefined {
  if (state.goals.some((goal) => goal.status === "active")) {
    return undefined;
  }
  const used = new Set(state.goals.map((goal) => goal.id));
  return content.goals.find((definition) => !used.has(definition.id));
}

export function contributionsForGoal(state: WorldState, goalId: GoalId): Contribution[] {
  return state.contributions.filter(
    (contribution) => contribution.goalId === goalId && contribution.status !== "released",
  );
}

export function goalProgress(state: WorldState, goal: Goal): GoalProgress {
  const required = mergeStacks(goal.requires);
  const contributed = new Map<ItemId, number>();
  for (const contribution of contributionsForGoal(state, goal.id)) {
    for (const [item, quantity] of mergeStacks(contribution.items)) {
      contributed.set(item, (contributed.get(item) ?? 0) + quantity);
    }
  }
  const entries: GoalProgressEntry[] = [...required].map(([item, quantity]) => {
    const given = contributed.get(item) ?? 0;
    return {
      item,
      required: quantity,
      contributed: given,
      remaining: Math.max(0, quantity - given),
    };
  });
  return {
    goalId: goal.id,
    entries,
    complete: entries.every((entry) => entry.contributed >= entry.required),
  };
}

export function progressStacks(progress: GoalProgress): ItemStack[] {
  return progress.entries.map((entry) => ({
    item: entry.item,
    quantity: entry.contributed,
  }));
}

/** Success is checked before expiry, so meeting the quota on the deadline wins. */
export function goalStatusAt(goal: Goal, progress: GoalProgress, currentTick: Tick): GoalStatus {
  if (goal.status !== "active") {
    return goal.status;
  }
  if (progress.complete) {
    return "succeeded";
  }
  if (currentTick >= goal.deadlineTick) {
    return "expired";
  }
  return "active";
}

/** Consume locked contributions and mark the goal succeeded (spec §9). */
export function succeedGoal(state: WorldState, goal: Goal, events?: EventLog): void {
  if (goal.status !== "active") {
    return;
  }
  for (const contribution of state.contributions) {
    if (contribution.goalId !== goal.id || contribution.status !== "locked") {
      continue;
    }
    const plot = plotOfPlayer(state, contribution.playerId);
    if (plot) {
      consumeLockedItems(state, plot.id, contribution.items);
    }
    contribution.status = "consumed";
  }
  goal.status = "succeeded";
  const payload: GoalCompletedPayload = { goalId: goal.id, rewards: goal.rewards };
  events?.emit("goal_completed", payload);
}

/** Release locks when a goal fails or expires (spec §9). */
export function releaseGoalContributions(state: WorldState, goal: Goal): void {
  for (const contribution of state.contributions) {
    if (contribution.goalId !== goal.id || contribution.status !== "locked") {
      continue;
    }
    const plot = plotOfPlayer(state, contribution.playerId);
    if (plot) {
      unlockItems(state, plot.id, contribution.items);
    }
    contribution.status = "released";
  }
}

export function expireGoal(state: WorldState, goal: Goal): void {
  if (goal.status !== "active") {
    return;
  }
  releaseGoalContributions(state, goal);
  goal.status = "expired";
}

function handleContribute(context: OrderExecutionContext): OrderOutcome {
  const { state, content, player, order } = context;
  const payload = order.payload as ContributeGoalPayload;
  const goal = state.goals.find((candidate) => candidate.id === payload.goalId);
  if (!goal) {
    return orderFailed(`Unknown goal ${payload.goalId}`);
  }
  if (goal.status !== "active") {
    return orderFailed(`Goal ${goal.id} is not active`);
  }
  if (state.world.currentTick >= goal.deadlineTick) {
    return orderFailed(`Goal ${goal.id} has reached its deadline`);
  }

  const plot = plotOfPlayer(state, player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }

  const items = mergeStacks(payload.items);
  if (items.size === 0) {
    return orderFailed("Contribution is empty");
  }

  const progress = goalProgress(state, goal);
  for (const [item, quantity] of items) {
    const entry = progress.entries.find((candidate) => candidate.item === item);
    if (!entry) {
      return orderFailed(`Goal ${goal.id} does not need ${item}`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return orderFailed(`Invalid contribution quantity for ${item}`);
    }
    if (quantity > entry.remaining) {
      return orderFailed(`Contribution exceeds the remaining ${item} for ${goal.id}`);
    }
  }

  const energyCost = orderEnergyCost(content, "contribute_goal");
  if (player.energy < energyCost) {
    return orderFailed(`Not enough energy to contribute to ${goal.id}`);
  }

  const prelocked = context.preLockedItems;
  if (!prelocked && !lockItems(state, plot.id, payload.items)) {
    return orderFailed(`Not enough free goods to contribute to ${goal.id}`);
  }
  if (!spendEnergy(player, energyCost)) {
    if (!prelocked) {
      unlockItems(state, plot.id, payload.items);
    }
    return orderFailed(`Not enough energy to contribute to ${goal.id}`);
  }

  state.contributions.push({
    id: `contribution:${order.id}`,
    goalId: goal.id,
    playerId: player.id,
    orderId: order.id,
    items: copyStacks(payload.items),
    status: "locked",
  });

  const updated = goalProgress(state, goal);
  const events = contextEvents(context);
  events?.emit("goal_contribution", {
    goalId: goal.id,
    playerId: player.id,
    items: copyStacks(payload.items),
  });
  const progressPayload: GoalProgressPayload = {
    goalId: goal.id,
    progress: progressStacks(updated),
    complete: updated.complete,
  };
  events?.emit("goal_progress", progressPayload);

  return orderSucceeded;
}

export function registerGoalHandlers(): void {
  registerOrderHandler("contribute_goal", handleContribute);
}
