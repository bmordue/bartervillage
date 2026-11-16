/**
 * Unit tests for the villager list fetch (M5.A08).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPlayers } from "../src/players.js";

describe("fetchPlayers (M5.A08)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the players endpoint with the world header", async () => {
    const payload = {
      players: [{ id: "p2", name: "Bea", plotId: "plot2", energy: 80 }],
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPlayers("http://api.test", "w9");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/players",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload.players);
  });

  it("returns an empty list when the response has no players", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await expect(fetchPlayers("", "w1")).resolves.toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );

    await expect(fetchPlayers("", "w1")).rejects.toThrow("500");
  });
});
