/**
 * Unit tests for the replay fetch and playback (spec §10; M5.C01).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplayPlayback, fetchLatestReplay, type TickReplayResponse } from "../src/replay.js";

const replay: TickReplayResponse = {
  tick: 3,
  header: {
    tick: 3,
    worldSeed: "seed",
    generatorVersion: "gen-1",
    contentVersion: "content-1",
    rulesVersion: "1.0.0",
  },
  events: [
    { tick: 3, sequence: 0, version: 1, type: "order_resolved", payload: { orderId: "o1" } },
    { tick: 3, sequence: 1, version: 1, type: "avatar_path", payload: { playerId: "p1" } },
  ],
};

describe("ReplayPlayback (M5.C01)", () => {
  it("starts at position zero", () => {
    const playback = new ReplayPlayback(replay);
    expect(playback.index).toBe(0);
    expect(playback.current).toBeUndefined();
    expect(playback.progress).toBe(0);
    expect(playback.isDone).toBe(false);
  });

  it("advances through events in recorded sequence order", () => {
    const playback = new ReplayPlayback(replay);
    const first = playback.next();
    expect(first?.sequence).toBe(0);
    const second = playback.next();
    expect(second?.sequence).toBe(1);
    expect(playback.isDone).toBe(true);
    expect(playback.next()).toBeUndefined();
  });

  it("resets back to the start", () => {
    const playback = new ReplayPlayback(replay);
    playback.next();
    playback.next();
    playback.reset();
    expect(playback.index).toBe(0);
    expect(playback.next()?.sequence).toBe(0);
  });
});

describe("fetchLatestReplay (M5.C01)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => replay,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed latest tick replay", async () => {
    const result = await fetchLatestReplay("", "w1");

    expect(result.tick).toBe(3);
    expect(result.header.tick).toBe(3);
    expect(result.events).toHaveLength(2);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "no_replay_data" }),
      })),
    );

    await expect(fetchLatestReplay("", "w1")).rejects.toThrow("GET /replay/latest failed with 404");
  });
});
