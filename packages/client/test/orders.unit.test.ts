/**
 * Unit tests for the queued orders fetch (M5.A03).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addOrder,
  fetchOrders,
  moveOrder,
  removeOrder,
  reorderOrders,
  TickInProgressError,
} from "../src/orders.js";

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

describe("order queue editing (M5.B02)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an order draft to the player's order endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ order: { id: "o1", sequence: 3 } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await addOrder("http://api.test", "w9", "p2", {
      type: "plant",
      payload: { tile: { x: 1, y: 2 }, crop: "wheat" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/player/p2/orders",
      expect.objectContaining({
        method: "POST",
        headers: {
          "x-world-id": "w9",
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "plant", payload: { tile: { x: 1, y: 2 }, crop: "wheat" } }),
      }),
    );
    expect(result).toEqual({ id: "o1", sequence: 3 });
  });

  it("deletes one queued order", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await removeOrder("http://api.test", "w9", "p2", "o1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/player/p2/orders/o1",
      expect.objectContaining({
        method: "DELETE",
        headers: { "x-world-id": "w9" },
      }),
    );
  });

  it("puts the new queue order", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await reorderOrders("http://api.test", "w9", "p2", ["b", "a"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/player/p2/orders",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "x-world-id": "w9",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orderIds: ["b", "a"] }),
      }),
    );
  });

  it("surfaces a tick-in-progress response as a typed error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "tick_in_progress" }), { status: 409 }),
      ),
    );

    await expect(removeOrder("", "w1", "p1", "o1")).rejects.toBeInstanceOf(TickInProgressError);
  });

  it("moves an id within a list without mutating the input", () => {
    const ids = ["a", "b", "c"];

    expect(moveOrder(ids, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveOrder(ids, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveOrder(ids, 1, 9)).toEqual(["a", "b", "c"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
