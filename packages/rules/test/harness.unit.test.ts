import { describe, expect, it } from "vitest";

import { makeOrder, runTick, scenario, TEST_CLOCK } from "./support/harness.js";

describe("rules unit-test harness", () => {
  it("builds a deterministic multi-player scenario", () => {
    const state = scenario({ players: 3 });
    expect(state.players.map((player) => player.id)).toEqual(["p1", "p2", "p3"]);
    expect(state.plots).toHaveLength(3);
  });

  it("builds typed orders", () => {
    const order = makeOrder("travel", { regionId: "r2" }, { id: "o9", playerId: "p2" });
    expect(order.type).toBe("travel");
    expect(order.payload).toEqual({ regionId: "r2" });
    expect(order.playerId).toBe("p2");
  });

  it("runs a tick through the harness", () => {
    const state = scenario();
    const result = runTick(state);
    expect(result.state.world.currentTick).toBe(state.world.currentTick + 1);
  });

  it("provides a fixed clock for scheduling", () => {
    expect(TEST_CLOCK.now().toISOString()).toBe("2026-11-07T20:00:00.000Z");
  });
});
