/**
 * Unit tests for the queued orders fetch (M5.A03).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOrders } from "../src/orders.js";

const payload = {
  orders: [
    {
      id: "o1",
      sequence: 1,
      type: "plant",
      payload: { item: "wheat" },
      status: "queued",
      failureReason: null,
    },
  ],
};

describe("fetchOrders (M5.A03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the player's order endpoint with the world header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOrders("http://api.test", "w9", "p2");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/player/p2/orders",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload.orders);
  });

  it("returns an empty list when the response has no orders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await expect(fetchOrders("", "w1", "p1")).resolves.toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    await expect(fetchOrders("", "w1", "ghost")).rejects.toThrow("404");
  });
});
