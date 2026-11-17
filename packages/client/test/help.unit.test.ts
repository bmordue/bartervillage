/**
 * Unit tests for the help flow helpers (M6.09).
 */

import { describe, expect, it } from "vitest";

import {
  availableHelpChores,
  createHelpOrder,
  HELP_ENERGY_COST,
  HELP_GOODWILL,
} from "../src/help.js";
import type { PlotSnapshot } from "../src/plot.js";

function plot(overrides: Partial<PlotSnapshot> = {}): PlotSnapshot {
  return {
    plot: {
      id: "plot2",
      playerId: "p2",
      regionId: "r1",
      siteX: 1,
      siteY: 0,
      width: 12,
      height: 12,
      worldOwned: false,
    },
    buildings: [],
    crops: [],
    animals: [],
    storage: { capacity: 100, used: 0, free: 100 },
    inventory: [],
    ready: null,
    ...overrides,
  };
}

describe("help flow (M6.09)", () => {
  it("builds a help order for the host plot and chore", () => {
    expect(createHelpOrder("plot2", "water")).toEqual({
      type: "help",
      payload: { targetPlotId: "plot2", chore: "water" },
    });
  });

  it("offers water and tend for unwatered and untended crops", () => {
    const host = plot({
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

    expect(availableHelpChores(host)).toEqual(["water", "tend"]);
  });

  it("skips chores that are already done", () => {
    const host = plot({
      crops: [
        {
          id: "c1",
          plotId: "plot2",
          tileX: 0,
          tileY: 0,
          type: "wheat",
          plantedTick: 1,
          growthTicks: 3,
          watered: true,
          tended: true,
          failed: false,
        },
      ],
    });

    expect(availableHelpChores(host)).toEqual([]);
  });

  it("offers feed only for hungry animals", () => {
    const host = plot({
      animals: [
        { id: "a1", plotId: "plot2", type: "chicken", count: 1, fed: true },
        { id: "a2", plotId: "plot2", type: "goat", count: 1, fed: false },
      ],
    });

    expect(availableHelpChores(host)).toEqual(["feed"]);
  });

  it("ignores failed crops", () => {
    const host = plot({
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
          failed: true,
        },
      ],
    });

    expect(availableHelpChores(host)).toEqual([]);
  });

  it("exposes the content energy and goodwill award", () => {
    expect(HELP_ENERGY_COST).toBeGreaterThan(0);
    expect(HELP_GOODWILL).toBe(1);
  });
});
