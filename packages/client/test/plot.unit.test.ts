/**
 * Unit tests for the plot snapshot fetch (M5.B01).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPlot } from "../src/plot.js";

const payload = {
  plot: {
    id: "plot1",
    playerId: "p1",
    regionId: "r1",
    siteX: 2,
    siteY: 3,
    width: 12,
    height: 12,
    worldOwned: false,
  },
  buildings: [
    {
      id: "b1",
      plotId: "plot1",
      type: "home",
      level: 1,
      constructionKind: null,
      constructionCompleteTick: null,
    },
  ],
  crops: [
    {
      id: "c1",
      plotId: "plot1",
      tileX: 0,
      tileY: 0,
      type: "wheat",
      plantedTick: 1,
      growthTicks: 2,
      watered: true,
      tended: false,
      failed: false,
    },
  ],
  animals: [{ id: "a1", plotId: "plot1", type: "chicken", count: 2, fed: true }],
  storage: { capacity: 40, used: 10, free: 30 },
  inventory: [{ item: "wheat", quantity: 10, locked: 3, free: 7 }],
  ready: null,
};

describe("fetchPlot (M5.B01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the plot endpoint with the world header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPlot("http://api.test", "w9", "plot2");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/plot/plot2",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload);
  });

  it("defaults optional collections and derives used storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plot: payload.plot,
              inventory: [{ item: "wood", quantity: 4, locked: 0, free: 4 }],
            }),
            { status: 200 },
          ),
      ),
    );

    const result = await fetchPlot("", "w1", "plot1");

    expect(result.buildings).toEqual([]);
    expect(result.crops).toEqual([]);
    expect(result.animals).toEqual([]);
    expect(result.storage).toEqual({ capacity: 0, used: 4, free: 0 });
  });

  it("throws when the response has no plot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await expect(fetchPlot("", "w1", "plot1")).rejects.toThrow("returned no plot");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    await expect(fetchPlot("", "w1", "missing")).rejects.toThrow("404");
  });
});
