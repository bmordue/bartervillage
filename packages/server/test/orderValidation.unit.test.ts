/**
 * Unit tests for server-side order re-validation (M4.B03).
 *
 * Validates that the server correctly re-validates orders against current world state,
 * providing authoritative feedback before queueing.
 */

import { describe, expect, it } from "vitest";

import type { ContentPack, Order, WorldState } from "@bartervillage/rules";
import { DEFAULT_MISSED_TICK_DEFAULTS, ORDER_TYPES } from "@bartervillage/rules";
import { validateOrderServerSide } from "@bartervillage/server";

function makeContent(): ContentPack {
  const costs = Object.fromEntries(ORDER_TYPES.map((type) => [type, 5])) as Record<
    (typeof ORDER_TYPES)[number],
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
    goodwill: { gift: 5, help: 1, badges: [] },
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
  };
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
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
    players: [
      {
        id: "p1",
        name: "Player One",
        plotId: "plot1",
        joinedTick: 0,
        energy: 100,
        defaults: { ...DEFAULT_MISSED_TICK_DEFAULTS },
      },
    ],
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
    orderLocks: [],
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
    ...overrides,
  } as WorldState;
}

function makeOrder(type: string, payload: Record<string, unknown>, playerId = "p1"): Order {
  return {
    id: "test-1",
    playerId,
    tick: 5,
    sequence: 1,
    type,
    payload,
    status: "queued",
    failureReason: null,
  } as unknown as Order;
}

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    posterId: "other",
    kind: "offer" as const,
    gives: [],
    wants: [],
    quantity: 0,
    createdAtTick: 0,
    expiryTick: 10,
    status: "open" as const,
    parentOfferId: null,
    ...overrides,
  };
}

describe("validateOrderServerSide (M4.B03)", () => {
  it("passes a valid travel order with enough energy", () => {
    const result = validateOrderServerSide(
      makeState(),
      makeContent(),
      makeOrder("travel", { regionId: "r2" }),
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("fails when the player has insufficient energy", () => {
    const state = makeState({
      players: [
        {
          id: "p1",
          name: "Player One",
          plotId: "plot1",
          joinedTick: 0,
          energy: 3,
          defaults: { ...DEFAULT_MISSED_TICK_DEFAULTS },
        },
      ],
    });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("travel", { regionId: "r2" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Not enough energy");
  });

  it("fails when trying to accept own post", () => {
    const state = makeState({ offers: [makeOffer({ posterId: "p1" })] });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("accept_offer", { offerId: "o1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Cannot accept your own post");
  });

  it("fails when trying to counter own post", () => {
    const state = makeState({ offers: [makeOffer({ posterId: "p1" })] });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("counter_offer", { parentOfferId: "o1", gives: [], wants: [] }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Cannot counter your own post");
  });

  it("fails when cancelling someone else's offer", () => {
    const state = makeState({ offers: [makeOffer({ posterId: "other" })] });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("cancel_offer", { offerId: "o1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("was not posted by this player");
  });

  it("fails when accepting a closed offer", () => {
    const state = makeState({ offers: [makeOffer({ status: "accepted" })] });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("accept_offer", { offerId: "o1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("is not open");
  });

  it("fails when the player is unknown", () => {
    const result = validateOrderServerSide(
      makeState(),
      makeContent(),
      makeOrder("travel", { regionId: "r2" }, "ghost"),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown player");
  });

  it("does not mutate the input state", () => {
    const state = makeState();
    const before = structuredClone(state);
    validateOrderServerSide(state, makeContent(), makeOrder("travel", { regionId: "r2" }));
    expect(state).toEqual(before);
  });

  it("rejects helping on your own plot", () => {
    const result = validateOrderServerSide(
      makeState(),
      makeContent(),
      makeOrder("help", { targetPlotId: "plot1", chore: "water" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("own plot");
  });

  it("accepts helping another player's plot", () => {
    const state = makeState({
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
        {
          id: "plot2",
          playerId: "p2",
          regionId: "r1",
          siteX: 12,
          siteY: 0,
          width: 12,
          height: 12,
          worldOwned: false,
        },
      ],
      crops: [
        {
          id: "c1",
          plotId: "plot2",
          tileX: 0,
          tileY: 0,
          type: "wheat",
          plantedTick: 1,
          growthTicks: 3,
          watered: false,
          tended: false,
          failed: false,
        },
      ],
    });
    const result = validateOrderServerSide(
      state,
      makeContent(),
      makeOrder("help", { targetPlotId: "plot2", chore: "water" }),
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });
});
