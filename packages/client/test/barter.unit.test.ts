/**
 * Unit tests for the barter board fetch (M5.A03).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBarter } from "../src/barter.js";

const payload = {
  offers: [
    {
      id: "o1",
      posterId: "p1",
      kind: "offer",
      gives: [{ item: "wheat", quantity: 2 }],
      wants: [{ item: "wood", quantity: 1 }],
      quantity: 1,
      createdAtTick: 3,
      expiryTick: 10,
      status: "open",
      parentOfferId: null,
    },
  ],
};

describe("fetchBarter (M5.A03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the barter endpoint with the world header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBarter("http://api.test", "w9");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/barter",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload.offers);
  });

  it("returns an empty list when the response has no offers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await expect(fetchBarter("", "w1")).resolves.toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );

    await expect(fetchBarter("", "w1")).rejects.toThrow("500");
  });
});
