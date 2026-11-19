/**
 * Tick poller unit tests (spec §14; M4.A02/M4.A03).
 *
 * Each poll tries the global tick lock. If another worker holds it, the poll
 * returns without resolving. Once the lock is held, the short-lived resolving
 * lease is taken in its own transaction; the lease and lock are released after
 * resolution succeeds or throws, and a crashed worker's lease expires by TTL.
 *
 * Persistent resolution failures are tracked in their own table (D.09): every
 * failed attempt is recorded per tick and, once the consecutive count reaches
 * the alert threshold (three by default), a structured alert is logged. The
 * poller keeps retrying on its normal cadence, and the host can also trigger a
 * safe manual retry through `retryWorldTick` or the REST endpoint.
 *
 * The `afterCommit` hook (M7.13) runs after tick resolution and lease/lock
 * release, used for side effects like push notifications.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireResolvingLease,
  Database,
  loadWorld,
  loadTickResolutionFailure,
} from "@bartervillage/server";

import { tryAcquireLock } from "../src/lock.js";
import { createTickPoller } from "../src/tickWorker.js";
import type { ResolveTickResult, TickHeader, WorldState } from "@bartervillage/rules";

let db: Database | undefined;
let directory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function setup(withWorld = true): {
  database: Database;
  path: string;
} {
  directory = mkdtempSync(join(tmpdir(), "barter-tick-"));
  const database = Database.open();
  db = database;
  if (withWorld) {
    database.run(
      `INSERT INTO worlds
         (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
          min_tick_gap_minutes, player_cap, season, weather)
       VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear')`,
    );
  }
  return { database, path: join(directory, "tick.lock") };
}

function makeWorldState(): WorldState {
  return {
    world: {
      id: "w1",
      config: {
        seed: "seed-1",
        generatorVersion: "gen-1",
        contentVersion: "content-1",
        rulesVersion: "rules-1",
        deadlineTime: "20:00",
        timezone: "UTC",
        minTickGapMinutes: 60,
        playerCap: 20,
      },
      currentTick: 1,
      season: "spring",
      weather: "clear",
      nextDeadline: null,
      resolving: null,
    },
    players: [],
    regions: [],
    tiles: [],
    plots: [],
    buildings: [],
    crops: [],
    animals: [],
    inventory: [],
    orders: [],
    orderLocks: [],
    ready: [],
    offers: [],
    wildNodes: [],
    claims: [],
    goals: [],
    contributions: [],
    goodwill: [],
    decorations: [],
    nextOrderSequence: 1,
    unlockedRecipes: [],
    unlockedCrops: [],
    unlockedBuildings: [],
    unlockedRegions: [],
    unlockedNodes: [],
  };
}

function makeHeader(tick: number): TickHeader {
  return {
    v: 1,
    worldSeed: "seed-1",
    tick,
    generatorVersion: "gen-1",
    contentVersion: "content-1",
    rulesVersion: "rules-1",
  };
}

function makeResolveResult(tick: number): ResolveTickResult {
  return {
    state: makeWorldState(),
    events: [],
    stateHash: `hash-${tick}`,
    header: makeHeader(tick),
  };
}

describe("tick poller", () => {
  it("runs resolution when it acquires the lock and releases it afterwards", async () => {
    const { database, path } = setup();
    const resolve = vi.fn(() => makeResolveResult(1));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve,
    });
    await poll();

    expect(resolve).toHaveBeenCalledWith({ database, worldId: "w1", tick: -1 });
    expect(logger).not.toHaveBeenCalled();
    expect(loadWorld(database, "w1")?.resolving).toBeNull();
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });

  it("skips resolution when another worker holds the lock", async () => {
    const { database, path } = setup();
    const held = tryAcquireLock({ path, owner: "worker-a" });
    const resolve = vi.fn(() => makeResolveResult(1));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-b",
      logger,
      resolve,
    });
    await poll();

    expect(resolve).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("worker: tick lock unavailable for world w1");
    held?.release();
  });

  it("releases the lock when resolution throws", async () => {
    const { database, path } = setup();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger: vi.fn(),
      resolve: () => {
        throw new Error("boom");
      },
    });

    await expect(poll()).rejects.toThrow("boom");
    expect(loadWorld(database, "w1")?.resolving).toBeNull();
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });

  it("skips resolution when a resolving lease is still held", async () => {
    const { database, path } = setup();
    acquireResolvingLease(database, "w1", { owner: "worker-a" });
    const resolve = vi.fn(() => makeResolveResult(1));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-b",
      logger,
      resolve,
    });
    await poll();

    expect(resolve).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("worker: resolving lease unavailable for world w1");
    expect(loadWorld(database, "w1")?.resolving?.owner).toBe("worker-a");
    expect(tryAcquireLock({ path, owner: "worker-c" })).not.toBeNull();
  });

  it("skips resolution when the tick is not due and releases the lock", async () => {
    const { database, path } = setup();
    const resolve = vi.fn(() => makeResolveResult(1));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve,
      shouldResolve: () => false,
    });
    await poll();

    expect(resolve).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("worker: tick not due for world w1");
    expect(loadWorld(database, "w1")?.resolving).toBeNull();
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });

  it("skips an unknown world and releases the lock", async () => {
    const { database, path } = setup(false);
    const resolve = vi.fn(() => makeResolveResult(1));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "missing",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve,
    });
    await poll();

    expect(resolve).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("worker: world missing not found");
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });
});

describe("persistent failure alerting (D.09)", () => {
  it("records consecutive failures and alerts on the third attempt", async () => {
    const { database, path } = setup();
    const logger = vi.fn();
    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve: () => {
        throw new Error("boom");
      },
    });

    await expect(poll()).rejects.toThrow("boom");
    await expect(poll()).rejects.toThrow("boom");
    await expect(poll()).rejects.toThrow("boom");

    expect(loadTickResolutionFailure(database, "w1", 0)?.failureCount).toBe(3);
    expect(logger.mock.calls.some(([message]) => String(message).includes("ALERT [D.09]"))).toBe(
      true,
    );
  });

  it("clears the failure streak after a successful resolution", async () => {
    const { database, path } = setup();
    let shouldFail = true;
    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger: vi.fn(),
      resolve: () => {
        if (shouldFail) {
          throw new Error("boom");
        }
        return makeResolveResult(1);
      },
    });

    await expect(poll()).rejects.toThrow("boom");
    expect(loadTickResolutionFailure(database, "w1", 0)?.resolved).toBe(false);

    shouldFail = false;
    await poll();

    expect(loadTickResolutionFailure(database, "w1", 0)?.resolved).toBe(true);
  });
});

describe("resolution transaction", () => {
  it("holds an immediate writer lock for the duration of resolution", async () => {
    directory = mkdtempSync(join(tmpdir(), "barter-tx-"));
    const databasePath = join(directory, "world.sqlite");
    const database = Database.open({ path: databasePath });
    db = database;
    database.run(
      `INSERT INTO worlds
         (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
          min_tick_gap_minutes, player_cap, season, weather)
       VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear')`,
    );
    const other = Database.open({ path: databasePath, busyTimeoutMs: 0 });
    let blockedWhileResolving = false;

    try {
      const poll = createTickPoller({
        database,
        worldId: "w1",
        lockPath: join(directory, "tick.lock"),
        owner: "worker-a",
        logger: vi.fn(),
        resolve: () => {
          try {
            other.run(
              `INSERT INTO worlds
                 (id, seed, generator_version, content_version, rules_version, deadline_time,
                  timezone, min_tick_gap_minutes, player_cap, season, weather)
               VALUES ('w2', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20,
                       'spring', 'clear')`,
            );
          } catch {
            blockedWhileResolving = true;
          }
        },
      });
      await poll();

      expect(blockedWhileResolving).toBe(true);
      other.run(
        `INSERT INTO worlds
           (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
           min_tick_gap_minutes, player_cap, season, weather)
         VALUES ('w3', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring',
                 'clear')`,
      );
      expect(other.get("SELECT id FROM worlds WHERE id = 'w3'")).toBeDefined();
    } finally {
      other.close();
    }
  });
});

describe("afterCommit hook (M7.13)", () => {
  it("calls afterCommit with tick and stateHash after successful resolution", async () => {
    const { database, path } = setup();
    const afterCommit = vi.fn();
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve: () => makeResolveResult(1),
      afterCommit,
    });

    await poll();

    expect(afterCommit).toHaveBeenCalledWith({
      worldId: "w1",
      tick: 1,
      stateHash: "hash-1",
    });
  });

  it("does not call afterCommit when resolution throws", async () => {
    const { database, path } = setup();
    const afterCommit = vi.fn();
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve: () => {
        throw new Error("boom");
      },
      afterCommit,
    });

    await expect(poll()).rejects.toThrow("boom");
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("logs but does not throw when afterCommit fails", async () => {
    const { database, path } = setup();
    const afterCommit = vi.fn(() => Promise.reject(new Error("push failed")));
    const logger = vi.fn();

    const poll = createTickPoller({
      database,
      worldId: "w1",
      lockPath: path,
      owner: "worker-a",
      logger,
      resolve: () => makeResolveResult(1),
      afterCommit,
    });

    await poll();

    expect(afterCommit).toHaveBeenCalled();
    expect(
      logger.mock.calls.some(([msg]) => String(msg).includes("after-commit hook failed")),
    ).toBe(true);
  });
});
