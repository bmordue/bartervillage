/**
 * Unit tests for map geometry and placeholder art (M5.A02).
 */

import { describe, expect, it } from "vitest";
import type { Plot, Region, Tile, WildNode } from "@bartervillage/rules";

import {
  buildMapView,
  regionOrigin,
  TILE_SIZE,
  tileColor,
  tileOrigin,
} from "../src/map/geometry.js";

const region: Region = { id: "r1", x: 1, y: 2, width: 4, height: 4 };

function tile(overrides: Partial<Tile> = {}): Tile {
  return {
    id: "t1",
    regionId: "r1",
    x: 2,
    y: 3,
    type: "wild",
    biome: "meadow",
    traits: { soil: 5, water: 5, light: 5 },
    ...overrides,
  };
}

describe("map geometry (M5.A02)", () => {
  it("uses 32x32 tiles", () => {
    expect(TILE_SIZE).toBe(32);
  });

  it("places a region on the world grid", () => {
    expect(regionOrigin(region)).toEqual({ x: 128, y: 256 });
  });

  it("places a tile inside its region", () => {
    expect(tileOrigin(region, { x: 2, y: 3 })).toEqual({ x: 192, y: 352 });
  });

  it("gives tile types distinct placeholder colours", () => {
    expect(tileColor("wild", "meadow")).not.toBe(tileColor("water", "meadow"));
    expect(tileColor("plot", "meadow")).not.toBe(tileColor("commons", "meadow"));
  });

  it("builds rects, plot outlines and wild-node markers", () => {
    const plots: Plot[] = [
      {
        id: "p1",
        playerId: "player1",
        regionId: "r1",
        siteX: 1,
        siteY: 2,
        width: 2,
        height: 2,
        worldOwned: false,
      },
    ];
    const nodes: WildNode[] = [
      {
        id: "n1",
        regionId: "r1",
        x: 3,
        y: 1,
        resource: "berries",
        amount: 5,
        capacity: 5,
        regrowRate: 1,
      },
    ];

    const view = buildMapView({
      regions: [region],
      tiles: [tile()],
      plots,
      wildNodes: nodes,
    });

    expect(view.width).toBe(256);
    expect(view.height).toBe(384);
    expect(view.rects[0]).toMatchObject({ x: 192, y: 352, width: 32, height: 32 });
    expect(view.outlines[0]).toMatchObject({ x: 160, y: 320, width: 64, height: 64 });
    expect(view.markers[0]).toMatchObject({ x: 240, y: 304, radius: 6 });
  });

  it("dims empty wild nodes", () => {
    const view = buildMapView({
      regions: [region],
      tiles: [],
      wildNodes: [
        {
          id: "n1",
          regionId: "r1",
          x: 0,
          y: 0,
          resource: "wood",
          amount: 0,
          capacity: 5,
          regrowRate: 1,
        },
      ],
    });
    expect(view.markers[0]?.color).toBe(0x6b6b6b);
  });

  it("appends replay overlay markers", () => {
    const view = buildMapView(
      { regions: [region], tiles: [] },
      { extraMarkers: [{ x: 10, y: 20, radius: 5, color: 0xff0000 }] },
    );
    expect(view.markers).toEqual([{ x: 10, y: 20, radius: 5, color: 0xff0000 }]);
  });

  it("skips tiles whose region is not in the source", () => {
    const view = buildMapView({ regions: [region], tiles: [tile({ regionId: "missing" })] });
    expect(view.rects).toHaveLength(0);
  });

  it("can omit plots and wild nodes", () => {
    const view = buildMapView(
      {
        regions: [region],
        tiles: [tile()],
        plots: [
          {
            id: "p1",
            playerId: null,
            regionId: "r1",
            siteX: 0,
            siteY: 0,
            width: 1,
            height: 1,
            worldOwned: true,
          },
        ],
        wildNodes: [
          {
            id: "n1",
            regionId: "r1",
            x: 0,
            y: 0,
            resource: "wood",
            amount: 1,
            capacity: 5,
            regrowRate: 1,
          },
        ],
      },
      { includePlots: false, includeWildNodes: false },
    );
    expect(view.outlines).toHaveLength(0);
    expect(view.markers).toHaveLength(0);
  });
});
