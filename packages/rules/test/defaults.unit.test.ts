import { describe, expect, it } from "vitest";

import { appendMissedTickDefaults, registerDefaultHandlers } from "../src/defaults.js";
import {
  ORDER_TYPES,
  type Animal,
  type AnimalDefinition,
  type Building,
  type BuildingDefinition,
  type ContentPack,
  type Crop,
  type CropDefinition,
  type EnergyConfig,
  type OrderType,
  type WorldState,
} from "../src/types.js";
import { makeOrder } from "./support/harness.js";
import { testContent, testWorldState } from "./fixtures.js";

const WHEAT: CropDefinition = {
  id: "wheat",
  name: "Wheat",
  growthTicks: 3,
  seasons: ["spring", "summer"],
  yield: [{ item: "grain", quantity: 2 }],
  wateringRequired: true,
  tendingRequired: false,
  frostSensitive: false,
  unlockedByDefault: true,
};

const CHICKEN: AnimalDefinition = {
  id: "chicken",
  name: "Chicken",
  produces: [{ item: "egg", quantity: 2 }],
  feedItem: "hay",
};

const STOREHOUSE: BuildingDefinition = {
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
      storageCapacity: 100,
      unlocksRecipes: [],
    },
  ],
};

const STOREHOUSE_BUILDING: Building = {
  id: "b1",
  plotId: "plot1",
  type: "storehouse",
  level: 1,
  constructionKind: null,
  constructionCompleteTick: null,
  craftQueue: [],
};

function energy(costs: Partial<Record<OrderType, number>> = {}): EnergyConfig {
  const table = Object.fromEntries(ORDER_TYPES.map((type) => [type, 0])) as Record<
    OrderType,
    number
  >;
  Object.assign(table, costs);
  return { dailyBudget: 100, travelPerBoundary: 5, costs: table };
}

function content(overrides: Partial<ContentPack> = {}): ContentPack {
  return testContent({
    crops: [WHEAT],
    animals: [CHICKEN],
    buildings: [STOREHOUSE],
    energy: energy({ harvest: 2, tend: 1, feed: 3 }),
    ...overrides,
  });
}

function stateWithStore(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({ buildings: [STOREHOUSE_BUILDING], ...overrides });
}

function crop(overrides: Partial<Crop> = {}): Crop {
  return {
    id: "c1",
    plotId: "plot1",
    tileX: 1,
    tileY: 1,
    type: "wheat",
    plantedTick: 3,
    growthTicks: 2,
    watered: false,
    tended: false,
    failed: false,
    ...overrides,
  };
}

function animal(overrides: Partial<Animal> = {}): Animal {
  return { id: "a1", plotId: "plot1", type: "chicken", count: 1, fed: false, ...overrides };
}

function defaultState(overrides: Partial<WorldState> = {}): WorldState {
  return stateWithStore({
    crops: [
      crop({ id: "c-ripe", tileX: 1, tileY: 1, plantedTick: 3, growthTicks: 2 }),
      crop({ id: "c-water", tileX: 2, tileY: 1, plantedTick: 5, watered: false }),
      crop({ id: "c-done", tileX: 3, tileY: 1, plantedTick: 5, watered: true }),
    ],
    animals: [animal({ id: "a-hungry" }), animal({ id: "a-fed", fed: true })],
    ...overrides,
  });
}

registerDefaultHandlers();

describe("appendMissedTickDefaults", () => {
  it("does nothing for a player who is ready for the current tick", () => {
    const state = defaultState({ ready: [{ playerId: "p1", tick: 5, position: 0 }] });
    expect(appendMissedTickDefaults(state, state.players[0]!, content())).toEqual([]);
    expect(state.orders).toEqual([]);
  });

  it("ignores ready entries from other ticks", () => {
    const state = defaultState({ ready: [{ playerId: "p1", tick: 4, position: 0 }] });
    expect(appendMissedTickDefaults(state, state.players[0]!, content())).toHaveLength(3);
  });

  it("appends harvest, then water, then feed after explicit orders", () => {
    const explicit = makeOrder("travel", { regionId: "r2" }, { id: "explicit", sequence: 10 });
    const state = defaultState({ orders: [explicit] });
    const added = appendMissedTickDefaults(state, state.players[0]!, content());
    expect(added.map((order) => order.type)).toEqual(["harvest", "tend", "feed"]);
    expect(added.map((order) => order.id)).toEqual([
      "default:p1:5:0",
      "default:p1:5:1",
      "default:p1:5:2",
    ]);
    expect(added.map((order) => order.sequence)).toEqual([11, 12, 13]);
    expect(added[0]?.payload).toEqual({ tile: { x: 1, y: 1 } });
    expect(added[1]?.payload).toEqual({ tile: { x: 2, y: 1 } });
    expect(added[2]?.payload).toEqual({ animalId: "a-hungry" });
    expect(state.orders).toHaveLength(4);
    expect(state.players[0]?.energy).toBe(100);
    expect(state.inventory).toEqual([]);
  });

  it("respects the per-player default switches and never tends", () => {
    const state = defaultState({
      crops: [
        crop({ id: "c-water", tileX: 2, tileY: 1, plantedTick: 5, watered: false }),
        crop({ id: "c-done", tileX: 3, tileY: 1, plantedTick: 5, watered: true }),
      ],
      players: [
        {
          ...testWorldState().players[0]!,
          defaults: { harvest: false, water: true, feed: false, tend: true },
        },
      ],
    });
    const added = appendMissedTickDefaults(state, state.players[0]!, content());
    expect(added.map((order) => order.type)).toEqual(["tend"]);
    expect(added[0]?.payload).toEqual({ tile: { x: 2, y: 1 } });
  });

  it("does not water crops it has already queued for harvest", () => {
    const state = defaultState({
      crops: [crop({ id: "c-ripe", tileX: 1, tileY: 1, plantedTick: 3, growthTicks: 2 })],
      animals: [],
    });
    const added = appendMissedTickDefaults(state, state.players[0]!, content());
    expect(added.map((order) => order.type)).toEqual(["harvest"]);
  });

  it("ignores failed crops and fed animals", () => {
    const state = defaultState({
      crops: [crop({ id: "c-failed", failed: true, watered: false }), crop({ id: "c-ripe" })],
      animals: [animal({ id: "a-fed", fed: true })],
    });
    const added = appendMissedTickDefaults(state, state.players[0]!, content());
    expect(added.map((order) => order.type)).toEqual(["harvest"]);
  });

  it("stops when energy is exhausted", () => {
    const state = defaultState({ players: [{ ...testWorldState().players[0]!, energy: 3 }] });
    const pack = content({ energy: energy({ harvest: 2, tend: 2, feed: 1 }) });
    const added = appendMissedTickDefaults(state, state.players[0]!, pack);
    expect(added.map((order) => order.type)).toEqual(["harvest"]);
    expect(state.players[0]?.energy).toBe(3);
  });

  it("stops when storage is exhausted", () => {
    const smallStore: BuildingDefinition = {
      ...STOREHOUSE,
      id: "smallStore",
      levels: [{ ...STOREHOUSE.levels[0]!, storageCapacity: 3 }],
    };
    const state = defaultState({
      buildings: [{ ...STOREHOUSE_BUILDING, type: "smallStore" }],
      crops: [
        crop({ id: "c-ripe-1", tileX: 1, tileY: 1, plantedTick: 3, growthTicks: 2 }),
        crop({ id: "c-ripe-2", tileX: 2, tileY: 1, plantedTick: 3, growthTicks: 2 }),
        crop({ id: "c-water", tileX: 3, tileY: 1, plantedTick: 5, watered: false }),
      ],
      animals: [],
    });
    const pack = content({
      buildings: [smallStore],
      energy: energy({ harvest: 0, tend: 0, feed: 0 }),
    });
    const added = appendMissedTickDefaults(state, state.players[0]!, pack);
    expect(added.map((order) => order.type)).toEqual(["harvest"]);
  });
});
