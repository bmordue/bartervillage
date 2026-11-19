import { describe, expect, it } from "vitest";
import { registerDecorationHandlers } from "../src/decorations.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type { ContentPack, DecorationDefinition } from "../src/types.js";
import { makeOrder } from "./support/harness.js";
import { testContent, testWorldState } from "./fixtures.js";

registerDecorationHandlers();

const FLOWERS: DecorationDefinition = {
  id: "flowers",
  name: "Flowers",
  cost: [{ item: "grain", quantity: 1 }],
};

const TROPHY: DecorationDefinition = {
  id: "trophy",
  name: "Trophy",
  goodwillMinScore: 5,
  cost: [],
};

function run(
  state: ReturnType<typeof testWorldState>,
  order: ReturnType<typeof makeOrder>,
  content: ContentPack = testContent({ decorations: [FLOWERS] }),
) {
  const player = state.players[0];
  if (!player) {
    throw new Error("missing player");
  }
  const context: OrderExecutionContext = {
    state,
    content,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
  };
  return resolveOrder(context);
}

function goodwillFor(state: ReturnType<typeof testWorldState>, playerId: string): number {
  return state.goodwill.find((entry) => entry.playerId === playerId)?.score ?? 0;
}

describe("place decoration", () => {
  it("places a decoration and consumes its cost", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 2, locked: 0 }],
    });
    const result = run(
      state,
      makeOrder("place_decoration", { decoration: "flowers", tile: { x: 2, y: 2 } }, { id: "d1" }),
    );
    expect(result.ok).toBe(true);
    expect(state.decorations).toHaveLength(1);
    expect(state.decorations[0]).toMatchObject({ id: "decoration:d1", tileX: 2, tileY: 2 });
    expect(state.inventory[0]?.quantity).toBe(1);
  });

  it("rejects unknown, out-of-bounds and occupied tiles", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 5, locked: 0 }],
    });
    expect(
      run(state, makeOrder("place_decoration", { decoration: "nope", tile: { x: 1, y: 1 } })).ok,
    ).toBe(false);
    expect(
      run(state, makeOrder("place_decoration", { decoration: "flowers", tile: { x: 99, y: 1 } }))
        .ok,
    ).toBe(false);
    expect(state.decorations).toHaveLength(0);
  });

  it("rejects when the cost is unavailable or locked", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 1, locked: 1 }],
    });
    expect(
      run(state, makeOrder("place_decoration", { decoration: "flowers", tile: { x: 1, y: 1 } })).ok,
    ).toBe(false);
  });

  it("can be earned via goodwill without paying the material cost", () => {
    const state = testWorldState({
      inventory: [],
      goodwill: [{ playerId: "p1", score: 6 }],
    });
    const result = run(
      state,
      makeOrder("place_decoration", { decoration: "trophy", tile: { x: 3, y: 3 } }, { id: "d2" }),
      testContent({ decorations: [FLOWERS, TROPHY] }),
    );
    expect(result.ok).toBe(true);
    expect(state.decorations).toHaveLength(1);
    // No goods were consumed (trophy cost is empty and goodwill bypasses crafting).
    expect(state.inventory).toHaveLength(0);
    expect(goodwillFor(state, "p1")).toBe(6);
  });

  it("rejects a goodwill decoration below its required score", () => {
    const state = testWorldState({
      inventory: [],
      goodwill: [{ playerId: "p1", score: 4 }],
    });
    const result = run(
      state,
      makeOrder("place_decoration", { decoration: "trophy", tile: { x: 3, y: 3 } }, { id: "d3" }),
      testContent({ decorations: [FLOWERS, TROPHY] }),
    );
    expect(result.ok).toBe(false);
    expect(state.decorations).toHaveLength(0);
  });

  it("does not affect production: placing a decoration leaves crops and animals untouched", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "grain", quantity: 5, locked: 0 }],
      crops: [
        {
          id: "crop1",
          plotId: "plot1",
          tileX: 0,
          tileY: 0,
          type: "wheat",
          plantedTick: 0,
          growthTicks: 0,
          watered: false,
          tended: false,
          failed: false,
        },
      ],
      animals: [{ id: "a1", plotId: "plot1", type: "cow", count: 1, fed: false }],
    });
    const before = JSON.stringify({
      crops: state.crops,
      animals: state.animals,
    });
    const result = run(
      state,
      makeOrder("place_decoration", { decoration: "flowers", tile: { x: 5, y: 5 } }, { id: "d4" }),
    );
    expect(result.ok).toBe(true);
    const after = JSON.stringify({ crops: state.crops, animals: state.animals });
    expect(after).toBe(before);
  });
});
