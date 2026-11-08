import { describe, expect, it } from "vitest";

import { advanceCrops, registerCropHandlers, witherOutOfSeason } from "../src/crops.js";
import { EventLog } from "../src/events.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import { Rng } from "../src/rng.js";
import {
  ORDER_TYPES,
  type Building,
  type BuildingDefinition,
  type ContentPack,
  type Crop,
  type CropDefinition,
  type EnergyConfig,
  type Order,
  type OrderType,
  type WeatherDefinition,
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
  wateringRequired: false,
  tendingRequired: false,
  frostSensitive: false,
  unlockedByDefault: true,
};

const WINTER_GREENS: CropDefinition = {
  ...WHEAT,
  id: "winterGreens",
  name: "Winter Greens",
  seasons: ["winter"],
};

const WEATHER: WeatherDefinition[] = [
  { id: "clear", name: "Clear", countsAsWatering: false, failureChance: 0, frostDamage: false },
  { id: "rain", name: "Rain", countsAsWatering: true, failureChance: 0, frostDamage: false },
  {
    id: "drought",
    name: "Drought",
    countsAsWatering: false,
    failureChance: 0.5,
    frostDamage: false,
  },
  { id: "frost", name: "Frost", countsAsWatering: false, failureChance: 0, frostDamage: true },
];

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
    weather: WEATHER,
    buildings: [STOREHOUSE],
    energy: energy({ plant: 4, tend: 1, harvest: 2 }),
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
    growthTicks: 3,
    watered: false,
    tended: false,
    failed: false,
    ...overrides,
  };
}

function runOrder(
  state: WorldState,
  pack: ContentPack,
  order: Order,
  events?: EventLog,
): ReturnType<typeof resolveOrder> {
  const player = state.players.find((candidate) => candidate.id === order.playerId);
  if (!player) {
    throw new Error("missing player");
  }
  const context = {
    state,
    content: pack,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set<string>(["r1"]),
    path: [],
  } as OrderExecutionContext & { events?: EventLog };
  if (events) {
    context.events = events;
  }
  return resolveOrder(context);
}

registerCropHandlers();

describe("plant order", () => {
  it("plants an unlocked in-season crop on an empty own tile", () => {
    const state = stateWithStore();
    const result = runOrder(
      state,
      content(),
      makeOrder("plant", { tile: { x: 2, y: 3 }, crop: "wheat" }, { id: "o-plant" }),
    );
    expect(result.ok).toBe(true);
    expect(state.players[0]?.energy).toBe(96);
    expect(state.crops).toHaveLength(1);
    expect(state.crops[0]).toMatchObject({
      id: "crop:o-plant",
      plotId: "plot1",
      tileX: 2,
      tileY: 3,
      type: "wheat",
      plantedTick: 5,
      growthTicks: 3,
      watered: false,
      tended: false,
      failed: false,
    });
  });

  it("rejects unknown, locked, and out-of-season crops", () => {
    const state = stateWithStore();
    expect(
      runOrder(state, content(), makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "mystery" })).ok,
    ).toBe(false);

    const locked = content({ crops: [{ ...WHEAT, unlockedByDefault: false }] });
    expect(
      runOrder(state, locked, makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "wheat" })).ok,
    ).toBe(false);

    const outOfSeason = content({ crops: [{ ...WHEAT, seasons: ["summer"] }] });
    expect(
      runOrder(state, outOfSeason, makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "wheat" })).ok,
    ).toBe(false);
    expect(state.crops).toEqual([]);
    expect(state.players[0]?.energy).toBe(100);
  });

  it("accepts a crop unlocked by the world", () => {
    const state = stateWithStore({ unlockedCrops: ["wheat"] });
    const locked = content({ crops: [{ ...WHEAT, unlockedByDefault: false }] });
    expect(
      runOrder(state, locked, makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "wheat" })).ok,
    ).toBe(true);
  });

  it("rejects tiles outside the plot or already occupied", () => {
    const state = stateWithStore({ crops: [crop()] });
    expect(
      runOrder(state, content(), makeOrder("plant", { tile: { x: 12, y: 1 }, crop: "wheat" })).ok,
    ).toBe(false);
    expect(
      runOrder(state, content(), makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "wheat" })).ok,
    ).toBe(false);
    expect(state.crops).toHaveLength(1);
  });

  it("rejects planting when energy is insufficient", () => {
    const state = stateWithStore({ players: [{ ...testWorldState().players[0]!, energy: 1 }] });
    const result = runOrder(
      state,
      content(),
      makeOrder("plant", { tile: { x: 1, y: 1 }, crop: "wheat" }),
    );
    expect(result.ok).toBe(false);
    expect(state.crops).toEqual([]);
    expect(state.players[0]?.energy).toBe(1);
  });
});

describe("tend order", () => {
  it("waters first, then tends on a subsequent order", () => {
    const state = stateWithStore({ crops: [crop()] });
    const pack = content();
    expect(runOrder(state, pack, makeOrder("tend", { tile: { x: 1, y: 1 } })).ok).toBe(true);
    expect(state.crops[0]?.watered).toBe(true);
    expect(state.crops[0]?.tended).toBe(false);
    expect(runOrder(state, pack, makeOrder("tend", { tile: { x: 1, y: 1 } })).ok).toBe(true);
    expect(state.crops[0]?.tended).toBe(true);
    expect(state.players[0]?.energy).toBe(98);
  });

  it("rejects a failed crop", () => {
    const state = stateWithStore({ crops: [crop({ failed: true })] });
    expect(runOrder(state, content(), makeOrder("tend", { tile: { x: 1, y: 1 } })).ok).toBe(false);
    expect(state.players[0]?.energy).toBe(100);
  });
});

describe("harvest order", () => {
  it("rejects an unripe crop without spending energy", () => {
    const state = stateWithStore({ crops: [crop({ plantedTick: 4 })] });
    const result = runOrder(state, content(), makeOrder("harvest", { tile: { x: 1, y: 1 } }));
    expect(result.ok).toBe(false);
    expect(state.players[0]?.energy).toBe(100);
    expect(state.crops).toHaveLength(1);
  });

  it("harvests a ripe crop into inventory, removes it and emits crop_grown", () => {
    const state = stateWithStore({ crops: [crop({ plantedTick: 2 })] });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content(),
      makeOrder("harvest", { tile: { x: 1, y: 1 } }, { id: "o-harvest" }),
      events,
    );
    expect(result.ok).toBe(true);
    expect(state.crops).toEqual([]);
    expect(state.inventory).toEqual([{ plotId: "plot1", item: "grain", quantity: 2, locked: 0 }]);
    expect(state.players[0]?.energy).toBe(98);
    expect(events.events.map((event) => event.type)).toEqual(["crop_grown"]);
    expect(events.events[0]?.payload).toMatchObject({
      cropId: "c1",
      plotId: "plot1",
      tile: { x: 1, y: 1 },
      cropType: "wheat",
    });
  });

  it("rejects harvest when the yield does not fit", () => {
    const state = testWorldState({ crops: [crop({ plantedTick: 2 })] });
    const result = runOrder(state, content(), makeOrder("harvest", { tile: { x: 1, y: 1 } }));
    expect(result.ok).toBe(false);
    expect(state.crops).toHaveLength(1);
    expect(state.inventory).toEqual([]);
    expect(state.players[0]?.energy).toBe(100);
  });
});

describe("advanceCrops", () => {
  it("treats rain as watering and consumes the previous flags", () => {
    const state = stateWithStore({
      world: { ...testWorldState().world, weather: "rain" },
      crops: [crop({ plantedTick: 4, watered: true, tended: true })],
    });
    const pack = content({ crops: [{ ...WHEAT, wateringRequired: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(false);
    expect(state.crops[0]?.watered).toBe(false);
    expect(state.crops[0]?.tended).toBe(false);
    expect(events.events).toEqual([]);
  });

  it("fails an unwatered crop under clear weather", () => {
    const state = stateWithStore({
      crops: [crop({ plantedTick: 4, watered: false })],
    });
    const pack = content({ crops: [{ ...WHEAT, wateringRequired: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(true);
    expect(events.events.map((event) => event.type)).toEqual(["crop_failed"]);
  });

  it("fails an untended crop when tending is required", () => {
    const state = stateWithStore({
      crops: [crop({ plantedTick: 4, tended: false })],
    });
    const pack = content({ crops: [{ ...WHEAT, tendingRequired: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(true);
    expect(events.events[0]?.payload).toMatchObject({ reason: "not tended" });
  });

  it("fails frost-sensitive crops and emits blight", () => {
    const state = stateWithStore({
      world: { ...testWorldState().world, weather: "frost" },
      crops: [crop({ plantedTick: 4, type: "wheat" })],
    });
    const pack = content({ crops: [{ ...WHEAT, frostSensitive: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(true);
    expect(events.events.map((event) => event.type)).toEqual(["crop_failed", "blight"]);
  });

  it("rolls weather failure chance with the injected RNG", () => {
    const state = stateWithStore({
      world: { ...testWorldState().world, weather: "drought" },
      crops: [crop({ plantedTick: 4 })],
    });
    const events = new EventLog(5);
    const alwaysFails = { chance: () => true } as unknown as Rng;
    advanceCrops(state, content(), alwaysFails, events);
    expect(state.crops[0]?.failed).toBe(true);
    expect(events.events.map((event) => event.type)).toEqual(["crop_failed", "blight"]);
  });

  it("skips failed crops and crops planted this tick", () => {
    const state = stateWithStore({
      crops: [crop({ id: "c-failed", failed: true }), crop({ id: "c-new", plantedTick: 5 })],
    });
    const pack = content({ crops: [{ ...WHEAT, wateringRequired: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(true);
    expect(state.crops[1]?.failed).toBe(false);
    expect(events.events).toEqual([]);
  });

  it("does not fail a crop that has reached its ripening tick", () => {
    const state = stateWithStore({
      crops: [crop({ plantedTick: 2, watered: true })],
    });
    const pack = content({ crops: [{ ...WHEAT, wateringRequired: true }] });
    const events = new EventLog(5);
    advanceCrops(state, pack, new Rng("test"), events);
    expect(state.crops[0]?.failed).toBe(false);
    expect(events.events).toEqual([]);
  });
});

describe("witherOutOfSeason", () => {
  it("removes crops that cannot grow in the new season", () => {
    const state = stateWithStore({
      crops: [
        crop({ id: "c-wheat", type: "wheat" }),
        crop({ id: "c-greens", type: "winterGreens" }),
      ],
    });
    const pack = content({ crops: [WHEAT, WINTER_GREENS] });
    const events = new EventLog(5);
    witherOutOfSeason(state, pack, "winter", events);
    expect(state.crops.map((candidate) => candidate.id)).toEqual(["c-greens"]);
    expect(events.events.map((event) => event.type)).toEqual(["crop_withered"]);
    expect(events.events[0]?.payload).toMatchObject({
      cropId: "c-wheat",
      reason: "cannot grow in winter",
    });
  });
});
