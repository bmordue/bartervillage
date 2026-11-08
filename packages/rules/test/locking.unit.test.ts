import { describe, expect, it } from "vitest";
import { resolveTick } from "../src/engine.js";
import { lockedQuantity } from "../src/world.js";
import { queueOrder } from "../src/locking.js";
import { removeOrder } from "../src/queue.js";
import type {
  Building,
  BuildingDefinition,
  ContentPack,
  Offer,
  RecipeDefinition,
  WorldState,
} from "../src/types.js";
import { testContent, testWorldState } from "./fixtures.js";

const kitchen: BuildingDefinition = {
  id: "kitchen",
  name: "Kitchen",
  biomeLocks: null,
  maxLevel: 2,
  levels: [
    {
      level: 1,
      cost: [{ item: "grain", quantity: 2 }],
      energyCost: 0,
      durationTicks: 1,
      storageCapacity: 100,
      unlocksRecipes: [],
    },
    {
      level: 2,
      cost: [{ item: "stone", quantity: 1 }],
      energyCost: 0,
      durationTicks: 1,
      storageCapacity: 100,
      unlocksRecipes: [],
    },
  ],
};

const jam: RecipeDefinition = {
  id: "jam",
  name: "Jam",
  building: "kitchen",
  buildingLevel: 1,
  inputs: [{ item: "grain", quantity: 2 }],
  outputs: [{ item: "berries", quantity: 1 }],
  durationTicks: 0,
  unlockedByDefault: true,
};

function content(overrides: Partial<ContentPack> = {}): ContentPack {
  return testContent({
    buildings: [kitchen],
    recipes: [jam],
    ...overrides,
  });
}

function building(overrides: Partial<Building> = {}): Building {
  return {
    id: "b1",
    plotId: "plot1",
    type: "kitchen",
    level: 1,
    constructionKind: null,
    constructionCompleteTick: null,
    craftQueue: [],
    ...overrides,
  };
}

function state(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({
    inventory: [{ plotId: "plot1", item: "grain", quantity: 5, locked: 0 }],
    ...overrides,
  });
}

describe("queue-time locking", () => {
  it("locks offered goods and releases them when the order is removed", () => {
    const world = state();
    const result = queueOrder(world, content(), {
      id: "offer-order",
      playerId: "p1",
      tick: 5,
      type: "post_offer",
      payload: {
        gives: [{ item: "grain", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        expiryTicks: 7,
      },
    });
    expect(result.ok).toBe(true);
    expect(lockedQuantity(world, "plot1", "grain")).toBe(2);
    expect(world.orderLocks).toHaveLength(1);
    expect(removeOrder(world, "offer-order")).not.toBeNull();
    expect(lockedQuantity(world, "plot1", "grain")).toBe(0);
    expect(world.orderLocks).toHaveLength(0);
  });

  it("transfers an offer lock to the post without unlocking it", () => {
    const world = state();
    queueOrder(world, content(), {
      id: "offer-order",
      playerId: "p1",
      tick: 5,
      type: "post_offer",
      payload: {
        gives: [{ item: "grain", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        expiryTicks: 7,
      },
    });
    const result = resolveTick({ state: world, content: content() });
    expect(result.state.offers).toHaveLength(1);
    expect(lockedQuantity(result.state, "plot1", "grain")).toBe(2);
    expect(result.state.orderLocks).toHaveLength(0);
  });

  it("locks craft inputs, consumes them once and clears the lock", () => {
    const world = state({ buildings: [building()] });
    queueOrder(world, content(), {
      id: "craft-order",
      playerId: "p1",
      tick: 5,
      type: "craft",
      payload: { buildingId: "b1", recipeId: "jam" },
    });
    expect(lockedQuantity(world, "plot1", "grain")).toBe(2);
    const result = resolveTick({ state: world, content: content() });
    expect(result.state.orders[0]?.status).toBe("resolved");
    expect(result.state.inventory.find((row) => row.item === "grain")?.quantity).toBe(3);
    expect(result.state.inventory.find((row) => row.item === "berries")?.quantity).toBe(1);
    expect(result.state.orderLocks).toHaveLength(0);
  });

  it("releases locks when a queued order fails", () => {
    const world = state({
      buildings: [building({ constructionKind: "build", constructionCompleteTick: 9 })],
    });
    queueOrder(world, content(), {
      id: "build-order",
      playerId: "p1",
      tick: 5,
      type: "build",
      payload: { building: "kitchen", tile: { x: 1, y: 1 } },
    });
    expect(lockedQuantity(world, "plot1", "grain")).toBe(2);
    const result = resolveTick({ state: world, content: content() });
    expect(result.state.orders[0]?.status).toBe("failed");
    expect(lockedQuantity(result.state, "plot1", "grain")).toBe(0);
    expect(result.state.inventory[0]?.quantity).toBe(5);
    expect(result.state.orderLocks).toHaveLength(0);
  });

  it("locks the accepter's side and releases it when acceptance fails", () => {
    const offer: Offer = {
      id: "offer:one",
      posterId: "p2",
      kind: "offer",
      gives: [{ item: "wood", quantity: 1 }],
      wants: [{ item: "grain", quantity: 2 }],
      quantity: 1,
      createdAtTick: 5,
      expiryTick: 12,
      status: "open",
      parentOfferId: null,
    };
    const world = state({
      players: [
        testWorldState().players[0]!,
        { ...testWorldState().players[0]!, id: "p2", name: "P2", plotId: "plot2" },
      ],
      plots: [
        ...testWorldState().plots,
        {
          id: "plot2",
          playerId: "p2",
          regionId: "r1",
          siteX: 1,
          siteY: 0,
          width: 12,
          height: 12,
          worldOwned: false,
        },
      ],
      offers: [offer],
    });
    queueOrder(world, content(), {
      id: "accept-order",
      playerId: "p1",
      tick: 5,
      type: "accept_offer",
      payload: { offerId: offer.id },
    });
    expect(lockedQuantity(world, "plot1", "grain")).toBe(2);
    const result = resolveTick({ state: world, content: content() });
    expect(result.state.orders[0]?.status).toBe("failed");
    expect(lockedQuantity(result.state, "plot1", "grain")).toBe(0);
  });
});
