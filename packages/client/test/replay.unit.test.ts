/**
 * Unit tests for the replay fetch and playback (spec §10; M5.C01).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplayPlayback, fetchLatestReplay, type TickReplayResponse } from "../src/replay.js";

const replay: TickReplayResponse = {
  tick: 3,
  header: {
    v: 1,
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

  it("allows unlimited replays of the same latest tick", () => {
    const playback = new ReplayPlayback(replay);

    for (let round = 0; round < 3; round += 1) {
      const played: number[] = [];
      for (let event = playback.next(); event !== undefined; event = playback.next()) {
        played.push(event.sequence);
      }
      expect(played).toEqual([0, 1]);
      expect(playback.isDone).toBe(true);
      playback.reset();
    }

    expect(playback.isDone).toBe(false);
    expect(playback.progress).toBe(0);
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

  it("returns the parsed latest tick replay with version metadata", async () => {
    const result = await fetchLatestReplay("", "w1");

    expect(result.tick).toBe(3);
    expect(result.header).toEqual(replay.header);
    expect(result.header.v).toBe(1);
    expect(result.header.rulesVersion).toBe("1.0.0");
    expect(result.events).toHaveLength(2);
  });

  it("rejects an unsupported replay schema version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ...replay, header: { ...replay.header, v: 2 } }),
      })),
    );

    await expect(fetchLatestReplay("", "w1")).rejects.toThrow(
      "Unsupported replay schema version 2",
    );
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
