import { afterEach, describe, expect, it } from "vitest";
import type { AvatarPath, GameEvent, TickHeader } from "@bartervillage/rules";
import { Database } from "../src/db/database.js";
import {
  appendTickLog,
  latestResolvedTick,
  loadArchivedEvents,
  loadAvatarPaths,
  loadLatestTickLog,
  loadTickLog,
} from "../src/db/tickRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function open(): Database {
  const database = Database.open();
  db = database;
  return database;
}

function seed(database: Database): void {
  database.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, season, weather)
     VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear')`,
  );
  database.run(
    "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P1', 'plot1', 0, 100)",
  );
}

function header(tick: number): TickHeader {
  return {
    v: 1,
    worldSeed: "seed",
    tick,
    generatorVersion: "gen-1",
    contentVersion: "content-1",
    rulesVersion: "rules-1",
  };
}

function event(tick: number, sequence: number, type: GameEvent["type"]): GameEvent {
  return {
    tick,
    sequence,
    version: 1,
    type,
    payload:
      type === "weather"
        ? { weather: "clear", season: "spring" }
        : { nodeId: "n1", resource: "berries", amount: 3 },
  } as GameEvent;
}

function avatarPath(tick: number): AvatarPath {
  return {
    playerId: "p1",
    tick,
    from: { regionId: "r1", x: 0, y: 0 },
    via: [],
    to: { regionId: "r1", x: 0, y: 0 },
    returnedHome: true,
  };
}

describe("tick repository", () => {
  it("round-trips a tick's header, hash, events and avatar paths", () => {
    const database = open();
    seed(database);
    const events = [event(5, 0, "weather"), event(5, 1, "node_regrown")];
    appendTickLog(database, {
      worldId: "w1",
      tick: 5,
      header: header(5),
      stateHash: "hash-5",
      events,
      avatarPaths: [avatarPath(5)],
    });

    const stored = loadTickLog(database, "w1", 5);

    expect(stored).toMatchObject({ tick: 5, stateHash: "hash-5", header: header(5) });
    expect(stored?.events).toEqual(events);
    expect(stored?.avatarPaths).toEqual([avatarPath(5)]);
  });

  it("is append-only: a duplicate tick is rejected and does not change history", () => {
    const database = open();
    seed(database);
    appendTickLog(database, {
      worldId: "w1",
      tick: 5,
      header: header(5),
      stateHash: "original",
      events: [event(5, 0, "weather")],
    });

    expect(() =>
      appendTickLog(database, {
        worldId: "w1",
        tick: 5,
        header: header(5),
        stateHash: "replacement",
        events: [event(5, 0, "node_regrown")],
      }),
    ).toThrow();

    const stored = loadTickLog(database, "w1", 5);
    expect(stored?.stateHash).toBe("original");
    expect(stored?.events.map((entry) => entry.type)).toEqual(["weather"]);
  });

  it("rejects duplicate event sequences within a tick", () => {
    const database = open();
    seed(database);
    expect(() =>
      appendTickLog(database, {
        worldId: "w1",
        tick: 5,
        header: header(5),
        stateHash: "hash-5",
        events: [event(5, 0, "weather"), event(5, 0, "node_regrown")],
      }),
    ).toThrow();
    expect(loadTickLog(database, "w1", 5)).toBeUndefined();
  });

  it("loads archived events across ticks in recorded order", () => {
    const database = open();
    seed(database);
    appendTickLog(database, {
      worldId: "w1",
      tick: 5,
      header: header(5),
      stateHash: "hash-5",
      events: [event(5, 1, "node_regrown"), event(5, 0, "weather")],
    });
    appendTickLog(database, {
      worldId: "w1",
      tick: 6,
      header: header(6),
      stateHash: "hash-6",
      events: [event(6, 0, "weather")],
    });

    expect(loadArchivedEvents(database, "w1").map((entry) => [entry.tick, entry.sequence])).toEqual(
      [
        [5, 0],
        [5, 1],
        [6, 0],
      ],
    );
  });

  it("exposes the latest resolved tick and its log", () => {
    const database = open();
    seed(database);
    expect(latestResolvedTick(database, "w1")).toBeUndefined();
    expect(loadLatestTickLog(database, "w1")).toBeUndefined();

    appendTickLog(database, {
      worldId: "w1",
      tick: 5,
      header: header(5),
      stateHash: "hash-5",
      events: [],
    });
    appendTickLog(database, {
      worldId: "w1",
      tick: 6,
      header: header(6),
      stateHash: "hash-6",
      events: [],
    });

    expect(latestResolvedTick(database, "w1")).toBe(6);
    expect(loadLatestTickLog(database, "w1")?.stateHash).toBe("hash-6");
  });

  it("filters avatar paths by tick", () => {
    const database = open();
    seed(database);
    appendTickLog(database, {
      worldId: "w1",
      tick: 5,
      header: header(5),
      stateHash: "hash-5",
      events: [],
      avatarPaths: [avatarPath(5)],
    });
    appendTickLog(database, {
      worldId: "w1",
      tick: 6,
      header: header(6),
      stateHash: "hash-6",
      events: [],
      avatarPaths: [{ ...avatarPath(6), returnedHome: false }],
    });

    expect(loadAvatarPaths(database, "w1", 5)).toHaveLength(1);
    expect(loadAvatarPaths(database, "w1", 6)[0]?.returnedHome).toBe(false);
  });
});
