import {
  DEFAULT_MISSED_TICK_DEFAULTS,
  ORDER_TYPES,
  type ContentPack,
  type Order,
  type OrderType,
  type Player,
  type WorldState,
} from "../src/types.js";

export function testContent(overrides: Partial<ContentPack> = {}): ContentPack {
  const costs = Object.fromEntries(ORDER_TYPES.map((type) => [type, 0])) as Record<
    OrderType,
    number
  >;
  return {
    version: "test-content-1",
    items: {
      grain: { name: "Grain" },
      wood: { name: "Wood" },
      stone: { name: "Stone" },
      fish: { name: "Fish" },
      berries: { name: "Berries" },
    },
    energy: { dailyBudget: 100, travelPerBoundary: 5, costs },
    goodwill: { gift: 5, help: 1 },
    crops: [],
    animals: [],
    recipes: [],
    buildings: [],
    biomes: [],
    weather: [],
    goals: [],
    phrases: [],
    wildNodes: [],
    decorations: [],
    ...overrides,
  };
}

export function testPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Player One",
    plotId: "plot1",
    joinedTick: 0,
    energy: 100,
    defaults: { ...DEFAULT_MISSED_TICK_DEFAULTS },
    ...overrides,
  };
}

export function testWorldState(overrides: Partial<WorldState> = {}): WorldState {
  const state: WorldState = {
    world: {
      id: "w1",
      config: {
        seed: "seed-1",
        generatorVersion: "gen-1",
        contentVersion: "test-content-1",
        rulesVersion: "1.0.0",
        deadlineTime: "20:00",
        timezone: "UTC",
        minTickGapMinutes: 60,
        playerCap: 20,
      },
      currentTick: 5,
      season: "spring",
      weather: "clear",
      nextDeadline: "2026-11-07T20:00:00.000Z",
      resolving: null,
    },
    players: [testPlayer()],
    regions: [
      { id: "r1", x: 0, y: 0, width: 12, height: 12 },
      { id: "r2", x: 1, y: 0, width: 12, height: 12 },
    ],
    tiles: [],
    plots: [
      {
        id: "plot1",
        playerId: "p1",
        regionId: "r1",
        siteX: 0,
        siteY: 0,
        width: 12,
        height: 12,
        worldOwned: false,
      },
    ],
    buildings: [],
    crops: [],
    animals: [],
    inventory: [],
    orders: [],
    ready: [],
    offers: [],
    wildNodes: [],
    claims: [],
    goals: [],
    contributions: [],
    goodwill: [],
    decorations: [],
    nextOrderSequence: 1,
    unlockedRecipes: [],
    unlockedCrops: [],
    unlockedBuildings: [],
    unlockedRegions: [],
    unlockedNodes: [],
  };
  return { ...state, ...overrides };
}

export function testOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    playerId: "p1",
    tick: 5,
    sequence: 1,
    type: "travel",
    payload: { regionId: "r2" },
    status: "queued",
    failureReason: null,
    ...overrides,
  } as Order;
}
