import { describe, expect, it } from "vitest";
import { content } from "@bartervillage/content";
import {
  appendRegion,
  BLOCK_SIZE,
  ensureOpenSites,
  openSites,
  generateRegion,
  MAP_GENERATOR_VERSION,
  PLOTS_PER_REGION,
  REGION_HEIGHT,
  REGION_WIDTH,
  regionId,
} from "../src/map.js";
import { testWorldState } from "./fixtures.js";

describe("map generation", () => {
  it("is deterministic for the same seed and version", () => {
    const a = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    const b = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    expect(b).toEqual(a);
  });

  it("changes when the seed or generator version changes", () => {
    const base = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    const otherSeed = generateRegion("other", MAP_GENERATOR_VERSION, 0, 0, content);
    const otherVersion = generateRegion("seed", "2", 0, 0, content);
    expect(otherSeed).not.toEqual(base);
    expect(otherVersion).not.toEqual(base);
  });

  it("uses stable region and tile ids with a full grid", () => {
    const generated = generateRegion("seed", "1", 2, 3, content);
    expect(generated.region.id).toBe(regionId(2, 3));
    expect(generated.tiles).toHaveLength(REGION_WIDTH * REGION_HEIGHT);
    expect(new Set(generated.tiles.map((tile) => tile.id)).size).toBe(generated.tiles.length);
  });

  it("provides plot sites, commons and wild nodes", () => {
    const generated = generateRegion("seed", "1", 0, 0, content);
    expect(generated.plots.filter((plot) => !plot.worldOwned)).toHaveLength(PLOTS_PER_REGION);
    expect(generated.plots.some((plot) => plot.worldOwned)).toBe(true);
    expect(generated.wildNodes.length).toBeGreaterThan(0);
    for (const node of generated.wildNodes) {
      expect(node.amount).toBeLessThanOrEqual(node.capacity);
      expect(node.capacity).toBeGreaterThanOrEqual(0);
    }
  });

  it("places plots on 12x12 aligned sites", () => {
    const generated = generateRegion("seed", "1", 0, 0, content);
    for (const plot of generated.plots) {
      expect(plot.width).toBe(BLOCK_SIZE);
      expect(plot.siteX % BLOCK_SIZE).toBe(0);
      expect(plot.siteY % BLOCK_SIZE).toBe(0);
    }
  });

  it("appends regions without changing existing ones", () => {
    const state = testWorldState({ regions: [], tiles: [], plots: [], wildNodes: [] });
    const first = appendRegion(state, content);
    const snapshot = structuredClone(first);
    const second = appendRegion(state, content);
    expect(second.region.id).not.toBe(first.region.id);
    expect(first.tiles).toEqual(snapshot.tiles);
    expect(first.plots).toEqual(snapshot.plots);
    expect(state.regions).toHaveLength(2);
  });
});

describe("open sites", () => {
  it("appends regions until the requested number of sites is open", () => {
    const state = testWorldState({ regions: [], tiles: [], plots: [], wildNodes: [] });
    const appended = ensureOpenSites(state, content, 6);
    expect(appended).toBe(2);
    expect(openSites(state)).toHaveLength(8);
  });
});
