import { describe, expect, it } from "vitest";

import { expandTileBatch } from "../src/batch.js";

const plant = {
  type: "plant",
  payload: { tile: { x: 2, y: 3 }, crop: "wheat" },
};

describe("expandTileBatch (M5.B03)", () => {
  it("keeps a single order unchanged", () => {
    expect(expandTileBatch(plant, { mode: "single", count: 1, width: 1, height: 1 })).toEqual([
      plant,
    ]);
  });

  it("fills a row from the origin tile", () => {
    const drafts = expandTileBatch(plant, { mode: "row", count: 3, width: 1, height: 1 });

    expect(drafts).toEqual([
      { type: "plant", payload: { tile: { x: 2, y: 3 }, crop: "wheat" } },
      { type: "plant", payload: { tile: { x: 3, y: 3 }, crop: "wheat" } },
      { type: "plant", payload: { tile: { x: 4, y: 3 }, crop: "wheat" } },
    ]);
  });

  it("fills an area row by row without mutating the input", () => {
    const drafts = expandTileBatch(plant, { mode: "area", count: 1, width: 2, height: 2 });

    expect(drafts.map((draft) => draft.payload["tile"])).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ]);
    expect(plant.payload.tile).toEqual({ x: 2, y: 3 });
    expect(drafts[0]?.payload).not.toBe(plant.payload);
  });

  it("rejects missing tiles and non-positive sizes", () => {
    expect(() =>
      expandTileBatch(
        { type: "plant", payload: {} },
        { mode: "row", count: 1, width: 1, height: 1 },
      ),
    ).toThrow(/tile/);
    expect(() => expandTileBatch(plant, { mode: "row", count: 0, width: 1, height: 1 })).toThrow(
      /Row size/,
    );
    expect(() => expandTileBatch(plant, { mode: "area", count: 1, width: 20, height: 20 })).toThrow(
      /Area size/,
    );
  });
});
