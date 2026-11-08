import { describe, expect, it } from "vitest";

import {
  InventoryError,
  addItems,
  canAddItems,
  consumeLockedItems,
  hasFreeItems,
  lockItems,
  removeFreeItems,
  unlockItems,
} from "../src/inventory.js";
import {
  freeCapacity,
  freeQuantity,
  heldQuantity,
  lockedQuantity,
  plotCapacity,
} from "../src/world.js";
import type { BuildingDefinition } from "../src/types.js";
import { testContent, testWorldState } from "./fixtures.js";

const storehouse: BuildingDefinition = {
  id: "storehouse",
  name: "Storehouse",
  biomeLocks: null,
  maxLevel: 2,
  levels: [
    {
      level: 1,
      cost: [],
      energyCost: 0,
      durationTicks: 0,
      storageCapacity: 100,
      unlocksRecipes: [],
    },
    {
      level: 2,
      cost: [],
      energyCost: 0,
      durationTicks: 0,
      storageCapacity: 150,
      unlocksRecipes: [],
    },
  ],
};

function content() {
  return testContent({ buildings: [storehouse] });
}

function stateWithStore() {
  return testWorldState({
    buildings: [
      {
        id: "b1",
        plotId: "plot1",
        type: "storehouse",
        level: 1,
        constructionKind: null,
        constructionCompleteTick: null,
        craftQueue: [],
      },
    ],
  });
}

describe("inventory and storage", () => {
  it("computes capacity from storage buildings and levels", () => {
    const state = stateWithStore();
    expect(plotCapacity(state, content(), "plot1")).toBe(100);
    state.buildings[0]!.level = 2;
    expect(plotCapacity(state, content(), "plot1")).toBe(150);
    expect(freeCapacity(state, content(), "plot1")).toBe(150);
  });

  it("adds goods up to capacity and rejects overflow", () => {
    const state = stateWithStore();
    addItems(state, content(), "plot1", [{ item: "wheat", quantity: 60 }]);
    addItems(state, content(), "plot1", [{ item: "wood", quantity: 40 }]);
    expect(freeCapacity(state, content(), "plot1")).toBe(0);
    expect(canAddItems(state, content(), "plot1", [{ item: "stone", quantity: 1 }])).toBe(false);
    expect(() => addItems(state, content(), "plot1", [{ item: "stone", quantity: 1 }])).toThrow(
      InventoryError,
    );
  });

  it("locks free stock without changing held or used capacity", () => {
    const state = stateWithStore();
    addItems(state, content(), "plot1", [{ item: "wheat", quantity: 10 }]);
    expect(lockItems(state, "plot1", [{ item: "wheat", quantity: 4 }])).toBe(true);
    expect(heldQuantity(state, "plot1", "wheat")).toBe(10);
    expect(lockedQuantity(state, "plot1", "wheat")).toBe(4);
    expect(freeQuantity(state, "plot1", "wheat")).toBe(6);
    expect(freeCapacity(state, content(), "plot1")).toBe(90);
    expect(lockItems(state, "plot1", [{ item: "wheat", quantity: 7 }])).toBe(false);
    expect(lockedQuantity(state, "plot1", "wheat")).toBe(4);
  });

  it("cannot spend, remove or re-lock locked stock", () => {
    const state = stateWithStore();
    addItems(state, content(), "plot1", [{ item: "wheat", quantity: 5 }]);
    lockItems(state, "plot1", [{ item: "wheat", quantity: 3 }]);
    expect(hasFreeItems(state, "plot1", [{ item: "wheat", quantity: 2 }])).toBe(true);
    expect(hasFreeItems(state, "plot1", [{ item: "wheat", quantity: 3 }])).toBe(false);
    expect(() => removeFreeItems(state, "plot1", [{ item: "wheat", quantity: 3 }])).toThrow();
  });

  it("unlocks and consumes locked goods correctly", () => {
    const state = stateWithStore();
    addItems(state, content(), "plot1", [{ item: "wheat", quantity: 5 }]);
    lockItems(state, "plot1", [{ item: "wheat", quantity: 3 }]);
    unlockItems(state, "plot1", [{ item: "wheat", quantity: 1 }]);
    expect(lockedQuantity(state, "plot1", "wheat")).toBe(2);
    expect(consumeLockedItems(state, "plot1", [{ item: "wheat", quantity: 2 }])).toBe(true);
    expect(heldQuantity(state, "plot1", "wheat")).toBe(3);
    expect(lockedQuantity(state, "plot1", "wheat")).toBe(0);
    expect(consumeLockedItems(state, "plot1", [{ item: "wheat", quantity: 1 }])).toBe(false);
  });

  it("prunes empty inventory rows", () => {
    const state = stateWithStore();
    addItems(state, content(), "plot1", [{ item: "wheat", quantity: 2 }]);
    removeFreeItems(state, "plot1", [{ item: "wheat", quantity: 2 }]);
    expect(state.inventory).toEqual([]);
  });
});
