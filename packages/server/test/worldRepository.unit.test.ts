import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/db/database.js";
import {
  acquireResolvingLease,
  isResolutionInProgress,
  loadWorld,
  releaseResolvingLease,
  setContentVersion,
} from "../src/db/worldRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function open(): Database {
  const database = Database.open();
  db = database;
  database.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, season, weather)
     VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear')`,
  );
  return database;
}

describe("world repository", () => {
  it("loads the pinned world configuration", () => {
    const database = open();

    const world = loadWorld(database, "w1");

    expect(world).toMatchObject({
      id: "w1",
      currentTick: 0,
      season: "spring",
      weather: "clear",
      resolving: null,
      config: {
        seed: "seed",
        generatorVersion: "gen-1",
        contentVersion: "content-1",
        rulesVersion: "rules-1",
        deadlineTime: "20:00",
        timezone: "UTC",
        minTickGapMinutes: 60,
        playerCap: 20,
      },
    });
  });

  it("returns undefined for an unknown world", () => {
    const database = open();
    expect(loadWorld(database, "missing")).toBeUndefined();
  });

  it("re-pins the content version between ticks", () => {
    const database = open();

    expect(setContentVersion(database, "w1", "content-2")).toBe(true);
    expect(loadWorld(database, "w1")?.config.contentVersion).toBe("content-2");
  });

  it("refuses to change the content version during resolution", () => {
    const database = open();
    database.run(
      `UPDATE worlds
       SET resolving_owner = 'worker-1',
           resolving_acquired_at = '2026-11-07T20:00:00.000Z',
           resolving_expires_at = '2026-11-07T20:01:00.000Z'
       WHERE id = 'w1'`,
    );

    expect(setContentVersion(database, "w1", "content-2")).toBe(false);
    const world = loadWorld(database, "w1");
    expect(world?.config.contentVersion).toBe("content-1");
    expect(world?.resolving?.owner).toBe("worker-1");
  });

  it("returns false when the world does not exist", () => {
    const database = open();
    expect(setContentVersion(database, "missing", "content-2")).toBe(false);
  });
});

describe("resolving lease", () => {
  const t0 = new Date("2026-11-07T20:00:00.000Z");

  it("acquires a lease when the world is free", () => {
    const database = open();

    const lease = acquireResolvingLease(database, "w1", { owner: "worker-1", now: t0 });

    expect(lease).toEqual({
      owner: "worker-1",
      acquiredAt: "2026-11-07T20:00:00.000Z",
      expiresAt: "2026-11-07T20:05:00.000Z",
    });
    expect(loadWorld(database, "w1")?.resolving?.owner).toBe("worker-1");
  });

  it("refuses a second lease until the first expires", () => {
    const database = open();
    acquireResolvingLease(database, "w1", { owner: "worker-1", now: t0 });

    expect(acquireResolvingLease(database, "w1", { owner: "worker-2", now: t0 })).toBeNull();
    expect(
      acquireResolvingLease(database, "w1", {
        owner: "worker-1",
        now: new Date(t0.getTime() + 5 * 60_000 + 1),
      }),
    ).not.toBeNull();
  });

  it("takes over an expired lease from a crashed worker", () => {
    const database = open();
    acquireResolvingLease(database, "w1", { owner: "worker-1", now: t0, ttlMs: 1000 });

    const lease = acquireResolvingLease(database, "w1", {
      owner: "worker-2",
      now: new Date(t0.getTime() + 1001),
    });

    expect(lease?.owner).toBe("worker-2");
  });

  it("releases only the owner's lease", () => {
    const database = open();
    acquireResolvingLease(database, "w1", { owner: "worker-1", now: t0 });

    expect(releaseResolvingLease(database, "w1", "worker-2")).toBe(false);
    expect(loadWorld(database, "w1")?.resolving?.owner).toBe("worker-1");

    expect(releaseResolvingLease(database, "w1", "worker-1")).toBe(true);
    expect(loadWorld(database, "w1")?.resolving).toBeNull();
  });

  it("reports whether resolution is still in progress", () => {
    const database = open();
    const world = loadWorld(database, "w1");
    expect(world).toBeDefined();
    if (!world) {
      return;
    }

    expect(isResolutionInProgress(world, t0)).toBe(false);
    acquireResolvingLease(database, "w1", { owner: "worker-1", now: t0 });
    const leased = loadWorld(database, "w1");
    expect(leased).toBeDefined();
    if (!leased) {
      return;
    }

    expect(isResolutionInProgress(leased, new Date(t0.getTime() + 1000))).toBe(true);
    expect(isResolutionInProgress(leased, new Date(t0.getTime() + 5 * 60_000))).toBe(false);
  });
});
