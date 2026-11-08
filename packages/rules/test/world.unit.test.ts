import { describe, expect, it } from "vitest";

import { refreshEnergy, regionDistance, spendEnergy, travelCostBetween } from "../src/world.js";
import { testContent, testPlayer, testWorldState } from "./fixtures.js";

describe("regions, travel and energy", () => {
  it("computes Manhattan distance and travel cost per boundary", () => {
    const state = testWorldState({
      regions: [
        { id: "r1", x: 0, y: 0, width: 12, height: 12 },
        { id: "r2", x: 1, y: 0, width: 12, height: 12 },
        { id: "r3", x: 1, y: 1, width: 12, height: 12 },
      ],
    });
    const content = testContent();
    expect(regionDistance(state.regions[0]!, state.regions[1]!)).toBe(1);
    expect(regionDistance(state.regions[0]!, state.regions[2]!)).toBe(2);
    expect(travelCostBetween(state, content, "r1", "r1")).toBe(0);
    expect(travelCostBetween(state, content, "r1", "r2")).toBe(5);
    expect(travelCostBetween(state, content, "r1", "r3")).toBe(10);
  });

  it("refreshes energy each tick with no carry-over", () => {
    const state = testWorldState({ players: [testPlayer({ energy: 3 })] });
    refreshEnergy(state, testContent());
    expect(state.players[0]?.energy).toBe(100);
  });

  it("spends energy only when the player can afford it", () => {
    const player = testPlayer({ energy: 7 });
    expect(spendEnergy(player, 8)).toBe(false);
    expect(player.energy).toBe(7);
    expect(spendEnergy(player, 5)).toBe(true);
    expect(player.energy).toBe(2);
  });
});
