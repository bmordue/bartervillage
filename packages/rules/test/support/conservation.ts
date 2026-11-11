/**
 * Inventory-conservation assertion helpers for tick tests (spec §3, §12; CT.08).
 *
 * Inventory only changes through explicit production or consumption. Tests
 * snapshot the state before a tick, declare the goods produced and consumed,
 * and these helpers assert that every inventory row moved by exactly that
 * amount. Goods moving between plots (trades, gifts) net to zero and so do not
 * need to be declared.
 */

import type { ItemId, ItemStack, WorldState } from "../../src/types.js";

export type InventoryTotals = Map<ItemId, number>;

function addDelta(totals: InventoryTotals, item: ItemId, quantity: number): void {
  totals.set(item, (totals.get(item) ?? 0) + quantity);
}

/** Total held quantity per item across every plot. Locked goods still count. */
export function inventoryTotals(state: WorldState): InventoryTotals {
  const totals: InventoryTotals = new Map();
  for (const row of state.inventory) {
    addDelta(totals, row.item, row.quantity);
  }
  return totals;
}

/** Net change per item between two snapshots. */
export function inventoryDelta(before: WorldState, after: WorldState): InventoryTotals {
  const delta: InventoryTotals = new Map();
  for (const [item, quantity] of inventoryTotals(before)) {
    addDelta(delta, item, -quantity);
  }
  for (const [item, quantity] of inventoryTotals(after)) {
    addDelta(delta, item, quantity);
  }
  for (const [item, quantity] of [...delta]) {
    if (quantity === 0) {
      delta.delete(item);
    }
  }
  return delta;
}

function signedTotals(
  produced: readonly ItemStack[],
  consumed: readonly ItemStack[],
): InventoryTotals {
  const expected: InventoryTotals = new Map();
  for (const stack of produced) {
    addDelta(expected, stack.item, stack.quantity);
  }
  for (const stack of consumed) {
    addDelta(expected, stack.item, -stack.quantity);
  }
  for (const [item, quantity] of [...expected]) {
    if (quantity === 0) {
      expected.delete(item);
    }
  }
  return expected;
}

function describe(totals: InventoryTotals): string {
  const entries = [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length === 0
    ? "(none)"
    : entries.map(([item, quantity]) => `${item}: ${quantity}`).join(", ");
}

function assertLedger(
  before: WorldState,
  after: WorldState,
  expected: InventoryTotals,
  context: string,
): void {
  const actual = inventoryDelta(before, after);
  const items = new Set([...expected.keys(), ...actual.keys()]);
  const mismatches: string[] = [];
  for (const item of [...items].sort()) {
    const want = expected.get(item) ?? 0;
    const got = actual.get(item) ?? 0;
    if (want !== got) {
      mismatches.push(`${item}: expected ${want}, got ${got}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `${context}: inventory conservation failed\n` +
        `  expected delta: ${describe(expected)}\n` +
        `  actual delta:   ${describe(actual)}\n` +
        `  ${mismatches.join("\n  ")}`,
    );
  }
}

/** Assert that every inventory row moved by exactly `produced - consumed`. */
export function assertInventoryChange(
  before: WorldState,
  after: WorldState,
  change: { produced?: readonly ItemStack[]; consumed?: readonly ItemStack[] },
  context = "inventory conservation",
): void {
  assertLedger(before, after, signedTotals(change.produced ?? [], change.consumed ?? []), context);
}

/** Assert that a tick left total inventory unchanged. */
export function assertInventoryConserved(
  before: WorldState,
  after: WorldState,
  context = "inventory conservation",
): void {
  assertInventoryChange(before, after, {}, context);
}
