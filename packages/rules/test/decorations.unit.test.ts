import { describe, expect, it } from "vitest";
import { registerDecorationHandlers } from "../src/decorations.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type { DecorationDefinition } from "../src/types.js";
import { makeOrder } from "./support/harness.js";
import { testContent, testWorldState } from "./fixtures.js";

registerDecorationHandlers();

const FLOWERS: DecorationDefinition = {
  id: "flowers",
  name: "Flowers",
  cost: [{ item: "grain", quantity: 1 }],
};

function run(state: ReturnType<typeof testWorldState>, order: ReturnType<typeof makeOrder>) {
  const player = state.players[0];
  if (!player) {
    throw new Error("missing player");
  }
  const context: OrderExecutionContext = {
    state,
    content: testContent({ decorations: [FLOWERS] }),
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
  };
  return resolveOrder(context);
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
});
