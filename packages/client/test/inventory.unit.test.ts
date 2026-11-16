/**
 * Unit tests for the plot inventory fetch (M5.A03).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchInventory } from "../src/inventory.js";

const payload = {
  inventory: [
    { item: "wheat", quantity: 10, locked: 3, free: 7 },
    { item: "wood", quantity: 4, locked: 0, free: 4 },
  ],
};

describe("fetchInventory (M5.A03)", () => {
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

    const result = await fetchInventory("http://api.test", "w9", "plot2");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/plot/plot2",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload.inventory);
  });

  it("returns an empty list when the response has no inventory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await expect(fetchInventory("", "w1", "plot1")).resolves.toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    await expect(fetchInventory("", "w1", "missing")).rejects.toThrow("404");
  });
});
