import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../src/db/database.js";
import {
  clearTickResolutionFailure,
  loadActiveTickFailures,
  loadTickResolutionFailure,
  recordTickResolutionFailure,
} from "../src/db/tickFailureRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function setup(): Database {
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

describe("tick resolution failure tracking", () => {
  it("counts consecutive failures for the same tick", () => {
    const database = setup();

    expect(recordTickResolutionFailure(database, "w1", 3)).toBe(1);
    expect(recordTickResolutionFailure(database, "w1", 3)).toBe(2);
    expect(recordTickResolutionFailure(database, "w1", 3)).toBe(3);

    expect(loadTickResolutionFailure(database, "w1", 3)).toMatchObject({
      worldId: "w1",
      tick: 3,
      failureCount: 3,
      resolved: false,
    });
  });

  it("tracks ticks independently", () => {
    const database = setup();

    recordTickResolutionFailure(database, "w1", 1);
    recordTickResolutionFailure(database, "w1", 1);
    recordTickResolutionFailure(database, "w1", 2);

    expect(loadTickResolutionFailure(database, "w1", 1)?.failureCount).toBe(2);
    expect(loadTickResolutionFailure(database, "w1", 2)?.failureCount).toBe(1);
  });

  it("marks a tick resolved after a successful attempt", () => {
    const database = setup();
    recordTickResolutionFailure(database, "w1", 0);

    clearTickResolutionFailure(database, "w1", 0);

    expect(loadTickResolutionFailure(database, "w1", 0)?.resolved).toBe(true);
    expect(loadActiveTickFailures(database, "w1")).toHaveLength(0);
  });

  it("returns only unresolved streaks for host inspection", () => {
    const database = setup();
    recordTickResolutionFailure(database, "w1", 0);
    recordTickResolutionFailure(database, "w1", 1);
    clearTickResolutionFailure(database, "w1", 0);

    expect(loadActiveTickFailures(database, "w1").map((entry) => entry.tick)).toEqual([1]);
  });

  it("returns undefined for a tick that never failed", () => {
    const database = setup();

    expect(loadTickResolutionFailure(database, "w1", 7)).toBeUndefined();
  });
});
