import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Database } from "@bartervillage/server";

import { tryAcquireLock } from "../src/lock.js";
import { createTickPoller } from "../src/tickWorker.js";

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

describe("tick poller", () => {
  it("runs resolution when it acquires the lock and releases it afterwards", async () => {
    const { database, path } = setup();
    const resolve = vi.fn();
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
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });

  it("skips resolution when another worker holds the lock", async () => {
    const { database, path } = setup();
    const held = tryAcquireLock({ path, owner: "worker-a" });
    const resolve = vi.fn();
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
    expect(tryAcquireLock({ path, owner: "worker-b" })).not.toBeNull();
  });

  it("skips an unknown world and releases the lock", async () => {
    const { database, path } = setup(false);
    const resolve = vi.fn();
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
