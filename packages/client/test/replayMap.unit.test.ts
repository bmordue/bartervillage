/**
 * Replay avatar paths and location following (M5.C02; spec §5, §10).
 */

import { describe, expect, it } from "vitest";

import {
  avatarPathsFromReplay,
  buildReplayMapView,
  focusForLocation,
  parseRegionId,
} from "../src/map/replayMap.js";
import type { TickReplayResponse } from "../src/replay.js";

const home = { regionId: "region:0:0", x: 0, y: 0 };
const visited = { regionId: "region:1:0", x: 1, y: 0 };

const replay: TickReplayResponse = {
  tick: 4,
  header: {
    tick: 4,
    worldSeed: "replay-seed",
    generatorVersion: "1",
    contentVersion: "1.0.0",
    rulesVersion: "1.0.0",
  },
  events: [
    {
      tick: 4,
      sequence: 0,
      version: 1,
      type: "avatar_path",
      payload: {
        path: {
          playerId: "p1",
          tick: 4,
          from: home,
          via: [visited],
          to: home,
          returnedHome: true,
        },
      },
    },
    {
      tick: 4,
      sequence: 1,
      version: 1,
      type: "weather",
      payload: { weather: "clear", season: "spring" },
    },
  ],
};

describe("avatarPathsFromReplay (M5.C02)", () => {
  it("extracts complete paths and ignores other events", () => {
    const paths = avatarPathsFromReplay(replay);

    expect(paths).toHaveLength(1);
    expect(paths[0]?.from).toEqual(home);
    expect(paths[0]?.via).toEqual([visited]);
    expect(paths[0]?.to).toEqual(home);
    expect(paths[0]?.returnedHome).toBe(true);
  });

  it("ignores avatar events with no path payload", () => {
    const paths = avatarPathsFromReplay({
      ...replay,
      events: [{ tick: 4, sequence: 0, version: 1, type: "avatar_path", payload: {} }],
    });

    expect(paths).toEqual([]);
  });

  it("parses generated region ids", () => {
    expect(parseRegionId("region:2:3")).toEqual({ x: 2, y: 3 });
    expect(parseRegionId("region:-1:0")).toEqual({ x: -1, y: 0 });
    expect(parseRegionId("region:not-a-number:0")).toBeUndefined();
    expect(parseRegionId("plot:1")).toBeUndefined();
  });
});

describe("buildReplayMapView (M5.C02)", () => {
  it("includes every visited region and draws the route home", () => {
    const view = buildReplayMapView(replay);

    expect(view.locations.map((location) => location.id)).toEqual(["region:0:0", "region:1:0"]);
    expect(view.width).toBe(3072);
    expect(view.height).toBe(1536);

    expect(view.paths).toHaveLength(1);
    const points = view.paths[0]?.points ?? [];
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual(points.at(-1));
    const avatars = view.markers.filter((marker) => marker.radius === 7);
    expect(avatars).toHaveLength(1);
    expect(avatars[0]).toMatchObject({ x: points[0]?.x, y: points[0]?.y });
  });

  it("falls back to the origin region when nobody travelled", () => {
    const view = buildReplayMapView({ ...replay, events: [] });

    expect(view.locations.map((location) => location.id)).toEqual(["region:0:0"]);
    expect(view.paths).toEqual([]);
    expect(view.markers.filter((marker) => marker.radius === 7)).toEqual([]);
  });

  it("builds a camera rectangle for a followed location", () => {
    const view = buildReplayMapView(replay);

    expect(focusForLocation(view.locations, "region:1:0")).toEqual({
      x: 1536,
      y: 0,
      width: 1536,
      height: 1536,
      color: 0x000000,
    });
    expect(focusForLocation(view.locations, "region:9:9")).toBeUndefined();
    expect(focusForLocation(view.locations, null)).toBeUndefined();
  });
});
