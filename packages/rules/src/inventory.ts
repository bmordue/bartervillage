/**
 * Plain stackable inventory with locks and storage capacity (spec §6.1, §7, §13).
 *
 * Locked goods still occupy capacity. Free stock is held minus locked, and only
 * free stock may be spent, cooked, gifted, contributed or re-offered.
 */

import type { ContentPack, ItemId, ItemStack, PlotId, WorldState } from "./types.js";
import { freeCapacity, freeQuantity, heldQuantity, inventoryRow, lockedQuantity } from "./world.js";

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

function mergeStacks(stacks: readonly ItemStack[]): Map<ItemId, number> {
  const merged = new Map<ItemId, number>();
  for (const stack of stacks) {
    if (!Number.isInteger(stack.quantity) || stack.quantity < 0) {
      throw new InventoryError(`Invalid quantity for ${stack.item}: ${stack.quantity}`);
    }
    merged.set(stack.item, (merged.get(stack.item) ?? 0) + stack.quantity);
  }
  return merged;
}

export function canAddItems(
  state: WorldState,
  content: ContentPack,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  return (
    freeCapacity(state, content, plotId) >=
    [...mergeStacks(stacks).values()].reduce((total, quantity) => total + quantity, 0)
  );
}

export function addItems(
  state: WorldState,
  content: ContentPack,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): void {
  const merged = mergeStacks(stacks);
  if (!canAddItems(state, content, plotId, stacks)) {
    throw new InventoryError(`Not enough storage capacity on ${plotId}`);
  }
  for (const [item, quantity] of merged) {
    if (quantity === 0) {
      continue;
    }
    const row = inventoryRow(state, plotId, item);
    if (row) {
      row.quantity += quantity;
    } else {
      state.inventory.push({ plotId, item, quantity, locked: 0 });
    }
  }
}

export function canRemoveFree(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  for (const [item, quantity] of mergeStacks(stacks)) {
    if (freeQuantity(state, plotId, item) < quantity) {
      return false;
    }
  }
  return true;
}

export function removeFreeItems(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): void {
  if (!canRemoveFree(state, plotId, stacks)) {
    throw new InventoryError(`Not enough free stock on ${plotId}`);
  }
  for (const [item, quantity] of mergeStacks(stacks)) {
    const row = inventoryRow(state, plotId, item);
    if (row) {
      row.quantity -= quantity;
    }
  }
  pruneEmptyRows(state, plotId);
}

export function canLockItems(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  return canRemoveFree(state, plotId, stacks);
}

export function lockItems(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  if (!canLockItems(state, plotId, stacks)) {
    return false;
  }
  for (const [item, quantity] of mergeStacks(stacks)) {
    if (quantity === 0) {
      continue;
    }
    let row = inventoryRow(state, plotId, item);
    if (!row) {
      row = { plotId, item, quantity: 0, locked: 0 };
      state.inventory.push(row);
    }
    row.locked += quantity;
  }
  return true;
}

export function unlockItems(state: WorldState, plotId: PlotId, stacks: readonly ItemStack[]): void {
  for (const [item, quantity] of mergeStacks(stacks)) {
    const row = inventoryRow(state, plotId, item);
    if (!row) {
      continue;
    }
    row.locked = Math.max(0, row.locked - quantity);
  }
  pruneEmptyRows(state, plotId);
}

export function consumeLockedItems(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  for (const [item, quantity] of mergeStacks(stacks)) {
    if (lockedQuantity(state, plotId, item) < quantity) {
      return false;
    }
  }
  for (const [item, quantity] of mergeStacks(stacks)) {
    const row = inventoryRow(state, plotId, item);
    if (row) {
      row.quantity -= quantity;
      row.locked -= quantity;
    }
  }
  pruneEmptyRows(state, plotId);
  return true;
}

export function hasItems(state: WorldState, plotId: PlotId, stacks: readonly ItemStack[]): boolean {
  return stacks.every((stack) => heldQuantity(state, plotId, stack.item) >= stack.quantity);
}

export function hasFreeItems(
  state: WorldState,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): boolean {
  return stacks.every((stack) => freeQuantity(state, plotId, stack.item) >= stack.quantity);
}

function pruneEmptyRows(state: WorldState, plotId: PlotId): void {
  state.inventory = state.inventory.filter(
    (row) => row.plotId !== plotId || row.quantity > 0 || row.locked > 0,
  );
}
