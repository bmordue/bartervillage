import { describe, expect, it } from "vitest";

import { registerAnimalHandlers, runAnimalProduction } from "../src/animals.js";
import { EventLog } from "../src/events.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import {
  ORDER_TYPES,
  type Animal,
  type AnimalDefinition,
  type Building,
  type BuildingDefinition,
  type ContentPack,
  type EnergyConfig,
  type Order,
  type OrderType,
  type WorldState,
} from "../src/types.js";
import { makeOrder } from "./support/harness.js";
import { testContent, testWorldState } from "./fixtures.js";

const CHICKEN: AnimalDefinition = {
  id: "chicken",
  name: "Chicken",
  produces: [{ item: "egg", quantity: 2 }],
  feedItem: "hay",
};

const COW: AnimalDefinition = {
  id: "cow",
  name: "Cow",
  produces: [
    { item: "egg", quantity: 1 },
    { item: "grain", quantity: 1 },
  ],
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
    animals: [CHICKEN],
    buildings: [STOREHOUSE],
    energy: energy({ feed: 3 }),
    ...overrides,
  });
}

function stateWithStore(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({ buildings: [STOREHOUSE_BUILDING], ...overrides });
}

function animal(overrides: Partial<Animal> = {}): Animal {
  return {
    id: "a1",
    plotId: "plot1",
    type: "chicken",
    count: 1,
    fed: false,
    ...overrides,
  };
}

function runOrder(
  state: WorldState,
  pack: ContentPack,
  order: Order,
): ReturnType<typeof resolveOrder> {
  const player = state.players.find((candidate) => candidate.id === order.playerId);
  if (!player) {
    throw new Error("missing player");
  }
  const context: OrderExecutionContext = {
    state,
    content: pack,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set<string>(["r1"]),
    path: [],
  };
  return resolveOrder(context);
}

registerAnimalHandlers();

describe("feed order", () => {
  it("feeds an animal on the player's plot and spends energy", () => {
    const state = stateWithStore({ animals: [animal()] });
    const result = runOrder(state, content(), makeOrder("feed", { animalId: "a1" }));
    expect(result.ok).toBe(true);
    expect(state.animals[0]?.fed).toBe(true);
    expect(state.players[0]?.energy).toBe(97);
  });

  it("rejects an animal on another plot", () => {
    const state = stateWithStore({ animals: [animal({ plotId: "plot2" })] });
    const result = runOrder(state, content(), makeOrder("feed", { animalId: "a1" }));
    expect(result.ok).toBe(false);
    expect(state.animals[0]?.fed).toBe(false);
    expect(state.players[0]?.energy).toBe(100);
  });

  it("rejects feeding when energy is insufficient", () => {
    const state = stateWithStore({
      players: [{ ...testWorldState().players[0]!, energy: 2 }],
      animals: [animal()],
    });
    const result = runOrder(state, content(), makeOrder("feed", { animalId: "a1" }));
    expect(result.ok).toBe(false);
    expect(state.animals[0]?.fed).toBe(false);
    expect(state.players[0]?.energy).toBe(2);
  });
});

describe("runAnimalProduction", () => {
  it("produces goods for fed animals and clears every fed flag", () => {
    const state = stateWithStore({
      animals: [animal({ id: "a1", fed: true }), animal({ id: "a2", fed: false })],
    });
    const events = new EventLog(5);
    runAnimalProduction(state, content(), events);
    expect(state.inventory).toEqual([{ plotId: "plot1", item: "egg", quantity: 2, locked: 0 }]);
    expect(state.animals.map((candidate) => candidate.fed)).toEqual([false, false]);
    expect(events.events.map((event) => event.type)).toEqual(["animal_produced"]);
    expect(events.events[0]?.payload).toMatchObject({
      animalId: "a1",
      plotId: "plot1",
      item: "egg",
      quantity: 2,
    });
  });

  it("emits one production event per produced stack", () => {
    const state = stateWithStore({ animals: [animal({ type: "cow", fed: true })] });
    const events = new EventLog(5);
    runAnimalProduction(state, content({ animals: [COW] }), events);
    expect(events.events.map((event) => event.type)).toEqual([
      "animal_produced",
      "animal_produced",
    ]);
    expect(state.inventory).toEqual([
      { plotId: "plot1", item: "egg", quantity: 1, locked: 0 },
      { plotId: "plot1", item: "grain", quantity: 1, locked: 0 },
    ]);
  });

  it("skips production when the goods do not fit, without losing the animal", () => {
    const state = testWorldState({ animals: [animal({ fed: true })] });
    const events = new EventLog(5);
    runAnimalProduction(state, content(), events);
    expect(state.inventory).toEqual([]);
    expect(state.animals).toHaveLength(1);
    expect(state.animals[0]?.fed).toBe(false);
    expect(events.events).toEqual([]);
  });

  it("skips unfed animals", () => {
    const state = stateWithStore({ animals: [animal({ fed: false })] });
    const events = new EventLog(5);
    runAnimalProduction(state, content(), events);
    expect(state.inventory).toEqual([]);
    expect(events.events).toEqual([]);
  });
});
