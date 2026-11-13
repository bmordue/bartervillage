import { describe, expect, it } from "vitest";

import { runAnimalProduction } from "../src/animals.js";
import { registerCraftingHandlers } from "../src/crafting.js";
import { EventLog } from "../src/events.js";
import { resolveWildClaims } from "../src/forage.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type {
  AnimalProducedPayload,
  BuildingDefinition,
  ContentPack,
  CraftPayloadEvent,
  RecipeDefinition,
  WorldState,
} from "../src/types.js";
import {
  assertInventoryChange,
  assertInventoryConserved,
  inventoryDelta,
  inventoryTotals,
} from "./support/conservation.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";

registerCraftingHandlers();

function stateWith(
  inventory: { plotId: string; item: string; quantity: number; locked: number }[],
) {
  return testWorldState({ inventory });
}

function storehouse(capacity: number): BuildingDefinition {
  return {
    id: "storehouse",
    name: "Storehouse",
    biomeLocks: null,
    maxLevel: 1,
    levels: [
      {
        level: 1,
        cost: [],
        energyCost: 0,
        durationTicks: 0,
        storageCapacity: capacity,
        unlocksRecipes: [],
      },
    ],
  };
}

const INSTANT_RECIPE: RecipeDefinition = {
  id: "berry_jam",
  name: "Berry jam",
  building: "kitchen",
  buildingLevel: 1,
  inputs: [{ item: "grain", quantity: 2 }],
  outputs: [{ item: "berries", quantity: 1 }],
  durationTicks: 0,
  unlockedByDefault: true,
};

function kitchen(): BuildingDefinition {
  return {
    id: "kitchen",
    name: "Kitchen",
    biomeLocks: null,
    maxLevel: 1,
    levels: [
      {
        level: 1,
        cost: [],
        energyCost: 0,
        durationTicks: 0,
        storageCapacity: 100,
        unlocksRecipes: [],
      },
    ],
  };
}

function forageScenario(): { state: WorldState; content: ContentPack } {
  const content = testContent({ buildings: [storehouse(100)] });
  const state = testWorldState({
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
    wildNodes: [
      {
        id: "n1",
        regionId: "r1",
        x: 1,
        y: 1,
        resource: "berries",
        amount: 10,
        capacity: 20,
        regrowRate: 2,
      },
    ],
    claims: [{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 }],
  });
  return { state, content };
}

describe("inventory conservation helper", () => {
  it("sums held quantity across plots and includes locked goods", () => {
    const totals = inventoryTotals(
      stateWith([
        { plotId: "plot1", item: "wheat", quantity: 3, locked: 1 },
        { plotId: "plot2", item: "wheat", quantity: 2, locked: 0 },
        { plotId: "plot1", item: "wood", quantity: 4, locked: 4 },
      ]),
    );

    expect(totals.get("wheat")).toBe(5);
    expect(totals.get("wood")).toBe(4);
  });

  it("computes net deltas and drops unchanged items", () => {
    const before = stateWith([{ plotId: "plot1", item: "wheat", quantity: 3, locked: 0 }]);
    const after = stateWith([
      { plotId: "plot1", item: "wheat", quantity: 1, locked: 0 },
      { plotId: "plot1", item: "wood", quantity: 2, locked: 0 },
    ]);

    const delta = inventoryDelta(before, after);

    expect(delta.get("wheat")).toBe(-2);
    expect(delta.get("wood")).toBe(2);
    expect(delta.size).toBe(2);
  });

  it("passes when the change matches production and consumption", () => {
    const before = stateWith([{ plotId: "plot1", item: "wheat", quantity: 5, locked: 0 }]);
    const after = stateWith([
      { plotId: "plot1", item: "wheat", quantity: 3, locked: 0 },
      { plotId: "plot1", item: "bread", quantity: 2, locked: 0 },
    ]);

    expect(() =>
      assertInventoryChange(before, after, {
        produced: [{ item: "bread", quantity: 2 }],
        consumed: [{ item: "wheat", quantity: 2 }],
      }),
    ).not.toThrow();
  });

  it("fails with a detailed ledger when an item is unaccounted for", () => {
    const before = stateWith([{ plotId: "plot1", item: "wheat", quantity: 5, locked: 0 }]);
    const after = stateWith([
      { plotId: "plot1", item: "wheat", quantity: 4, locked: 0 },
      { plotId: "plot1", item: "bread", quantity: 1, locked: 0 },
    ]);

    expect(() =>
      assertInventoryChange(before, after, {
        produced: [{ item: "bread", quantity: 2 }],
      }),
    ).toThrow(/bread: expected 2, got 1/);
    expect(() =>
      assertInventoryChange(before, after, {
        produced: [{ item: "bread", quantity: 2 }],
      }),
    ).toThrow(/wheat: expected 0, got -1/);
  });

  it("passes when a tick leaves inventory unchanged", () => {
    const before = stateWith([{ plotId: "plot1", item: "wheat", quantity: 3, locked: 1 }]);
    const after = stateWith([{ plotId: "plot1", item: "wheat", quantity: 3, locked: 1 }]);

    expect(() => assertInventoryConserved(before, after)).not.toThrow();
  });

  it("fails when a tick changes inventory without production or consumption", () => {
    const before = stateWith([{ plotId: "plot1", item: "wheat", quantity: 3, locked: 0 }]);
    const after = stateWith([{ plotId: "plot1", item: "wheat", quantity: 2, locked: 0 }]);

    expect(() => assertInventoryConserved(before, after)).toThrow(/wheat: expected 0, got -1/);
  });

  it("treats transfers between plots as conserved", () => {
    const before = stateWith([
      { plotId: "plot1", item: "wheat", quantity: 3, locked: 0 },
      { plotId: "plot2", item: "wheat", quantity: 1, locked: 0 },
    ]);
    const after = stateWith([
      { plotId: "plot1", item: "wheat", quantity: 1, locked: 0 },
      { plotId: "plot2", item: "wheat", quantity: 3, locked: 0 },
    ]);

    expect(() => assertInventoryConserved(before, after)).not.toThrow();
  });
});

describe("conservation in tick phases", () => {
  it("accounts for wild-node yields as production", () => {
    const { state, content } = forageScenario();
    const before = structuredClone(state);

    resolveWildClaims(state, content, new EventLog(5));

    expect(state.inventory).toEqual([
      { plotId: "plot1", item: "berries", quantity: 10, locked: 0 },
    ]);
    expect(() =>
      assertInventoryChange(before, state, {
        produced: [{ item: "berries", quantity: 10 }],
      }),
    ).not.toThrow();
  });

  it("accounts for animal production from its events", () => {
    const content = testContent({
      animals: [
        {
          id: "chicken",
          name: "Chicken",
          produces: [{ item: "egg", quantity: 2 }],
          feedItem: "hay",
        },
      ],
      buildings: [storehouse(100)],
    });
    const state = testWorldState({
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
      animals: [{ id: "a1", plotId: "plot1", type: "chicken", count: 1, fed: true }],
    });
    const before = structuredClone(state);
    const events = new EventLog(5);

    runAnimalProduction(state, content, events);

    const produced = events.events
      .filter((event) => event.type === "animal_produced")
      .map((event) => {
        const payload = event.payload as AnimalProducedPayload;
        return { item: payload.item, quantity: payload.quantity };
      });
    expect(produced).toEqual([{ item: "egg", quantity: 2 }]);
    expect(() => assertInventoryChange(before, state, { produced })).not.toThrow();
  });

  it("accounts for crafting consumption and production from its events", () => {
    const content = testContent({ buildings: [kitchen()], recipes: [INSTANT_RECIPE] });
    const state = testWorldState({
      buildings: [
        {
          id: "kitchen-1",
          plotId: "plot1",
          type: "kitchen",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [],
        },
      ],
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    const before = structuredClone(state);
    const events = new EventLog(5);
    const player = state.players[0]!;
    const context = {
      state,
      content,
      order: testOrder({
        id: "craft-1",
        type: "craft",
        payload: { buildingId: "kitchen-1", recipeId: "berry_jam" },
      }),
      player,
      location: { regionId: "r1" },
      reachable: new Set<string>(["r1"]),
      path: [],
      events,
    } as OrderExecutionContext & { events: EventLog };

    expect(resolveOrder(context).ok).toBe(true);

    const completed = events.events.find((event) => event.type === "craft_completed");
    expect(completed).toBeDefined();
    const recipe = content.recipes.find(
      (candidate) => candidate.id === (completed?.payload as CraftPayloadEvent).recipeId,
    );
    expect(recipe).toBeDefined();
    expect(() =>
      assertInventoryChange(before, state, {
        consumed: recipe!.inputs,
        produced: recipe!.outputs,
      }),
    ).not.toThrow();
  });
});
