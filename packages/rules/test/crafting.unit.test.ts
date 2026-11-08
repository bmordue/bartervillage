import { describe, expect, it } from "vitest";

import { advanceCrafting, isRecipeUnlocked, registerCraftingHandlers } from "../src/crafting.js";
import { EventLog } from "../src/events.js";
import { addItems, removeFreeItems } from "../src/inventory.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type {
  BuildingDefinition,
  ContentPack,
  CraftPayload,
  Order,
  RecipeDefinition,
  WorldState,
} from "../src/types.js";
import { heldQuantity, lockedQuantity } from "../src/world.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";

registerCraftingHandlers();

const kitchen: BuildingDefinition = {
  id: "kitchen",
  name: "Kitchen",
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
      storageCapacity: 100,
      unlocksRecipes: [],
    },
  ],
};

function kitchenWithCapacity(storageCapacity: number): BuildingDefinition {
  return {
    ...kitchen,
    levels: kitchen.levels.map((level) => ({ ...level, storageCapacity })),
  };
}

const instantRecipe: RecipeDefinition = {
  id: "berry_jam",
  name: "Berry jam",
  building: "kitchen",
  buildingLevel: 1,
  inputs: [{ item: "grain", quantity: 2 }],
  outputs: [{ item: "berries", quantity: 1 }],
  durationTicks: 0,
  unlockedByDefault: true,
};

const timedRecipe: RecipeDefinition = {
  id: "plank",
  name: "Plank",
  building: "kitchen",
  buildingLevel: 1,
  inputs: [{ item: "wood", quantity: 2 }],
  outputs: [{ item: "stone", quantity: 1 }],
  durationTicks: 2,
  unlockedByDefault: true,
};

const secretRecipe: RecipeDefinition = {
  id: "secret",
  name: "Secret",
  building: "kitchen",
  buildingLevel: 1,
  inputs: [{ item: "wood", quantity: 1 }],
  outputs: [{ item: "stone", quantity: 2 }],
  durationTicks: 0,
  unlockedByDefault: false,
};

const levelTwoRecipe: RecipeDefinition = {
  id: "feast",
  name: "Feast",
  building: "kitchen",
  buildingLevel: 2,
  inputs: [{ item: "grain", quantity: 1 }],
  outputs: [{ item: "berries", quantity: 2 }],
  durationTicks: 0,
  unlockedByDefault: true,
};

const wrongBuildingRecipe: RecipeDefinition = {
  id: "bread",
  name: "Bread",
  building: "bakery",
  buildingLevel: 1,
  inputs: [{ item: "grain", quantity: 1 }],
  outputs: [{ item: "berries", quantity: 1 }],
  durationTicks: 0,
  unlockedByDefault: true,
};

const recipes = [instantRecipe, timedRecipe, secretRecipe, levelTwoRecipe, wrongBuildingRecipe];

function content(building: BuildingDefinition = kitchen): ContentPack {
  const base = testContent({ buildings: [building], recipes });
  return {
    ...base,
    energy: {
      ...base.energy,
      costs: { ...base.energy.costs, craft: 2 },
    },
  };
}

function stateWithKitchen(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({
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
    ...overrides,
  });
}

function runOrder(
  state: WorldState,
  pack: ContentPack,
  order: Order,
  events: EventLog = new EventLog(state.world.currentTick),
): { ok: boolean; reason: string | null; events: EventLog } {
  const player = state.players[0]!;
  const context = {
    state,
    content: pack,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
    events,
  } as OrderExecutionContext & { events: EventLog };
  const outcome = resolveOrder(context);
  return { ok: outcome.ok, reason: outcome.reason, events };
}

function craftOrder(payload: CraftPayload, overrides: Partial<Order> = {}): Order {
  return testOrder({ id: "craft-1", type: "craft", payload, ...overrides } as Partial<Order>);
}

describe("recipe unlocks", () => {
  it("requires the default or shared-goal unlock and the building level gate", () => {
    const state = stateWithKitchen();
    const building = state.buildings[0]!;
    const pack = content();

    expect(isRecipeUnlocked(state, pack, "berry_jam", building)).toBe(true);
    expect(isRecipeUnlocked(state, pack, "secret", building)).toBe(false);
    expect(isRecipeUnlocked(state, pack, "feast", building)).toBe(false);
    expect(isRecipeUnlocked(state, pack, "unknown", building)).toBe(false);

    state.unlockedRecipes.push("secret");
    expect(isRecipeUnlocked(state, pack, "secret", building)).toBe(true);

    building.level = 2;
    expect(isRecipeUnlocked(state, pack, "feast", building)).toBe(true);

    building.level = 0;
    expect(isRecipeUnlocked(state, pack, "berry_jam", building)).toBe(false);
  });
});

describe("crafting", () => {
  it("produces an instant recipe in the order phase", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
      events,
    );

    expect(result.ok).toBe(true);
    expect(heldQuantity(state, "plot1", "grain")).toBe(8);
    expect(heldQuantity(state, "plot1", "berries")).toBe(1);
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(state.players[0]?.energy).toBe(98);
    expect(state.buildings[0]?.craftQueue).toEqual([]);
    expect(events.events.map((event) => event.type)).toEqual(["craft_started", "craft_completed"]);
    expect(events.events[1]?.payload).toMatchObject({ completesTick: 5 });
  });

  it("fails an instant recipe before mutation when storage cannot hold the output", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content(kitchenWithCapacity(0)),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
      events,
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("capacity");
    expect(heldQuantity(state, "plot1", "grain")).toBe(10);
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(state.players[0]?.energy).toBe(100);
    expect(events.events).toHaveLength(0);
  });

  it("starts the first timed job immediately and completes it on schedule", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "plank" }),
      events,
    );

    expect(result.ok).toBe(true);
    const queue = state.buildings[0]!.craftQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ startedTick: 5, completesTick: 7 });
    expect(heldQuantity(state, "plot1", "wood")).toBe(8);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(0);
    expect(state.players[0]?.energy).toBe(98);
    expect(events.events.map((event) => event.type)).toEqual(["craft_started"]);

    state.world.currentTick = 6;
    advanceCrafting(state, content(), new EventLog(6));
    expect(state.buildings[0]!.craftQueue).toHaveLength(1);
    expect(heldQuantity(state, "plot1", "stone")).toBe(0);

    state.world.currentTick = 7;
    const completed = new EventLog(7);
    advanceCrafting(state, content(), completed);
    expect(state.buildings[0]!.craftQueue).toHaveLength(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(1);
    expect(completed.events.map((event) => event.type)).toEqual(["craft_completed"]);
    expect(completed.events[0]?.payload).toMatchObject({ completesTick: 7 });
  });

  it("keeps queued jobs locked until the previous job completes, then starts them in order", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const first = runOrder(
      state,
      content(),
      craftOrder({ id: "craft-1", buildingId: "kitchen-1", recipeId: "plank" }),
    );
    const second = runOrder(
      state,
      content(),
      craftOrder({ id: "craft-2", buildingId: "kitchen-1", recipeId: "plank" }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    let queue = state.buildings[0]!.craftQueue;
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ startedTick: 5, completesTick: 7 });
    expect(queue[1]).toMatchObject({ startedTick: 5, completesTick: 7 });
    expect(lockedQuantity(state, "plot1", "wood")).toBe(2);

    state.world.currentTick = 7;
    const firstCompletion = new EventLog(7);
    advanceCrafting(state, content(), firstCompletion);
    queue = state.buildings[0]!.craftQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ startedTick: 7, completesTick: 9 });
    expect(heldQuantity(state, "plot1", "wood")).toBe(6);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(1);
    expect(firstCompletion.events.map((event) => event.type)).toEqual(["craft_completed"]);

    state.world.currentTick = 8;
    advanceCrafting(state, content(), new EventLog(8));
    expect(heldQuantity(state, "plot1", "stone")).toBe(1);

    state.world.currentTick = 9;
    const secondCompletion = new EventLog(9);
    advanceCrafting(state, content(), secondCompletion);
    expect(state.buildings[0]!.craftQueue).toHaveLength(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(2);
    expect(secondCompletion.events[0]?.payload).toMatchObject({ completesTick: 9 });
  });

  it("retries a completed job when storage is full instead of dropping outputs", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 2, locked: 0 }],
    });
    const pack = content(kitchenWithCapacity(5));
    expect(
      runOrder(state, pack, craftOrder({ buildingId: "kitchen-1", recipeId: "plank" })).ok,
    ).toBe(true);
    expect(heldQuantity(state, "plot1", "wood")).toBe(0);

    addItems(state, pack, "plot1", [{ item: "stone", quantity: 5 }]);
    state.world.currentTick = 7;
    const blocked = new EventLog(7);
    advanceCrafting(state, pack, blocked);
    expect(state.buildings[0]!.craftQueue).toHaveLength(1);
    expect(state.buildings[0]!.craftQueue[0]?.completesTick).toBe(7);
    expect(blocked.events).toHaveLength(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(5);

    removeFreeItems(state, "plot1", [{ item: "stone", quantity: 1 }]);
    const retried = new EventLog(7);
    advanceCrafting(state, pack, retried);
    expect(state.buildings[0]!.craftQueue).toHaveLength(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(5);
    expect(retried.events.map((event) => event.type)).toEqual(["craft_completed"]);
  });

  it("rejects recipes that are unknown, at the wrong building, locked or unaffordable", () => {
    const base = (): WorldState =>
      stateWithKitchen({
        inventory: [
          { plotId: "plot1", item: "grain", quantity: 10, locked: 0 },
          { plotId: "plot1", item: "wood", quantity: 10, locked: 0 },
        ],
      });

    const unknown = runOrder(
      base(),
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "nope" }),
    );
    expect(unknown.ok).toBe(false);

    const wrongBuilding = runOrder(
      base(),
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "bread" }),
    );
    expect(wrongBuilding.ok).toBe(false);

    const locked = runOrder(
      base(),
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "secret" }),
    );
    expect(locked.ok).toBe(false);
    expect(locked.reason).toContain("not unlocked");

    const lowLevel = runOrder(
      base(),
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "feast" }),
    );
    expect(lowLevel.ok).toBe(false);

    const poor = base();
    poor.players[0]!.energy = 1;
    const noEnergy = runOrder(
      poor,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
    );
    expect(noEnergy.ok).toBe(false);
    expect(heldQuantity(poor, "plot1", "grain")).toBe(10);
    expect(lockedQuantity(poor, "plot1", "grain")).toBe(0);
    expect(poor.players[0]?.energy).toBe(1);
  });

  it("rejects crafting at an incomplete or foreign building", () => {
    const incomplete = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    incomplete.buildings[0]!.constructionKind = "build";
    incomplete.buildings[0]!.constructionCompleteTick = 6;
    const notComplete = runOrder(
      incomplete,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
    );
    expect(notComplete.ok).toBe(false);

    const foreign = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    foreign.buildings[0]!.plotId = "plot2";
    const notOwned = runOrder(
      foreign,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
    );
    expect(notOwned.ok).toBe(false);
  });

  it("does not spend locked goods", () => {
    const state = stateWithKitchen({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 10 }],
    });
    const result = runOrder(
      state,
      content(),
      craftOrder({ buildingId: "kitchen-1", recipeId: "berry_jam" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("free goods");
    expect(state.players[0]?.energy).toBe(100);
  });

  it("emits completion events in deterministic building id order", () => {
    const job = {
      recipeId: "plank",
      startedTick: 3,
      completesTick: 5,
      inputs: [],
      outputs: [{ item: "stone", quantity: 1 }],
    };
    const state = testWorldState({
      buildings: [
        {
          id: "b2",
          plotId: "plot1",
          type: "kitchen",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [{ ...job }],
        },
        {
          id: "b1",
          plotId: "plot1",
          type: "kitchen",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [{ ...job }],
        },
      ],
    });
    const events = new EventLog(5);
    advanceCrafting(state, content(), events);
    expect(events.events.map((event) => event.payload)).toEqual([
      { buildingId: "b1", plotId: "plot1", recipeId: "plank", completesTick: 5 },
      { buildingId: "b2", plotId: "plot1", recipeId: "plank", completesTick: 5 },
    ]);
  });
});
