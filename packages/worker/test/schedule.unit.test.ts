import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "@bartervillage/server";
import { afterEach, describe, expect, it } from "vitest";

import { isTickDue, tickIsDue } from "../src/schedule.js";

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

describe("tickIsDue", () => {
  const now = new Date("2026-11-07T20:00:00.000Z");

  it("is due when every player is ready", () => {
    expect(tickIsDue({ playerCount: 2, readyCount: 2, nextDeadline: null, now })).toBe(true);
  });

  it("is not due while players are missing from the ready set", () => {
    expect(tickIsDue({ playerCount: 2, readyCount: 1, nextDeadline: null, now })).toBe(false);
  });

  it("is due at or after the deadline", () => {
    expect(
      tickIsDue({
        playerCount: 2,
        readyCount: 0,
        nextDeadline: "2026-11-07T20:00:00.000Z",
        now,
      }),
    ).toBe(true);
    expect(
      tickIsDue({
        playerCount: 2,
        readyCount: 0,
        nextDeadline: "2026-11-07T20:00:01.000Z",
        now,
      }),
    ).toBe(false);
  });

  it("never triggers an empty world", () => {
    expect(
      tickIsDue({
        playerCount: 0,
        readyCount: 0,
        nextDeadline: "2020-01-01T00:00:00.000Z",
        now,
      }),
    ).toBe(false);
  });
});

describe("isTickDue", () => {
  function setup(): Database {
    directory = mkdtempSync(join(tmpdir(), "barter-schedule-"));
    const database = Database.open({ path: join(directory, "world.sqlite") });
    db = database;
    database.run(
      `INSERT INTO worlds
         (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
          min_tick_gap_minutes, player_cap, current_tick, season, weather, next_deadline)
       VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 0,
               'spring', 'clear', '2026-11-07T20:00:00.000Z')`,
    );
    return database;
  }

  function addPlayer(database: Database, id: string): void {
    database.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, 0)`,
      id,
      id,
      `plot-${id}`,
    );
  }

  it("waits for the roster and then for readiness", () => {
    const database = setup();
    const now = new Date("2026-11-07T10:00:00.000Z");

    expect(isTickDue(database, "w1", now)).toBe(false);

    addPlayer(database, "p1");
    addPlayer(database, "p2");
    expect(isTickDue(database, "w1", now)).toBe(false);

    database.run("INSERT INTO ready (player_id, tick, position) VALUES ('p1', 0, 0)");
    expect(isTickDue(database, "w1", now)).toBe(false);

    database.run("INSERT INTO ready (player_id, tick, position) VALUES ('p2', 0, 1)");
    expect(isTickDue(database, "w1", now)).toBe(true);
  });

  it("triggers on the deadline even when nobody is ready", () => {
    const database = setup();
    addPlayer(database, "p1");

    expect(isTickDue(database, "w1", new Date("2026-11-07T19:59:59.000Z"))).toBe(false);
    expect(isTickDue(database, "w1", new Date("2026-11-07T20:00:00.000Z"))).toBe(true);
  });
});
