/**
 * Unit tests for the player status fetch (M5.A04).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPlayer } from "../src/player.js";

const payload = {
  player: { id: "p2", name: "Grace", plotId: "plot2", energy: 88 },
  ready: { tick: 9, position: 3 },
};

describe("fetchPlayer (M5.A04)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the player endpoint with the world header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPlayer("http://api.test", "w9", "p2");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/player/p2",
      expect.objectContaining({ headers: { "x-world-id": "w9" } }),
    );
    expect(result).toEqual(payload);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    await expect(fetchPlayer("", "w1", "ghost")).rejects.toThrow("404");
  });
});
