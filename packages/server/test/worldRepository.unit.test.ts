import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/db/database.js";
import { loadWorld, setContentVersion } from "../src/db/worldRepository.js";

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
