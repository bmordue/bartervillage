import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../src/db/database.js";
import {
  createSession,
  deleteSession,
  loadPlayerSessions,
  loadSession,
  purgeExpiredSessions,
} from "../src/db/sessionRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function open(): Database {
  const database = Database.open();
  db = database;
  database.run(
    `INSERT INTO players (id, name, plot_id, joined_tick, energy)
     VALUES ('p1', 'Ada', 'plot-1', 0, 100)`,
  );
  return database;
}

const t0 = new Date("2026-11-07T20:00:00.000Z");

describe("session repository", () => {
  it("creates a session with an absolute expiry", () => {
    const database = open();

    const session = createSession(database, {
      id: "s1",
      playerId: "p1",
      now: t0,
      ttlMs: 60_000,
    });

    expect(session).toEqual({
      id: "s1",
      playerId: "p1",
      createdAt: "2026-11-07T20:00:00.000Z",
      expiresAt: "2026-11-07T20:01:00.000Z",
    });
    expect(loadSession(database, "s1", new Date(t0.getTime() + 59_999))).toEqual(session);
  });

  it("treats an expired session as absent", () => {
    const database = open();
    createSession(database, { id: "s1", playerId: "p1", now: t0, ttlMs: 1000 });

    expect(loadSession(database, "s1", new Date(t0.getTime() + 1000))).toBeUndefined();
  });

  it("returns undefined for an unknown session", () => {
    expect(loadSession(open(), "missing")).toBeUndefined();
  });

  it("logs out by deleting the session", () => {
    const database = open();
    createSession(database, { id: "s1", playerId: "p1", now: t0 });

    expect(deleteSession(database, "s1")).toBe(true);
    expect(loadSession(database, "s1", t0)).toBeUndefined();
    expect(deleteSession(database, "s1")).toBe(false);
  });

  it("purges expired sessions only", () => {
    const database = open();
    createSession(database, { id: "expired", playerId: "p1", now: t0, ttlMs: 1000 });
    createSession(database, { id: "active", playerId: "p1", now: t0, ttlMs: 60_000 });

    expect(purgeExpiredSessions(database, new Date(t0.getTime() + 2000))).toBe(1);
    expect(loadSession(database, "expired", t0)).toBeUndefined();
    expect(loadSession(database, "active", new Date(t0.getTime() + 2000))).toBeDefined();
  });

  it("lists a player's sessions deterministically", () => {
    const database = open();
    createSession(database, { id: "s2", playerId: "p1", now: new Date(t0.getTime() + 1000) });
    createSession(database, { id: "s1", playerId: "p1", now: t0 });

    expect(loadPlayerSessions(database, "p1").map((session) => session.id)).toEqual(["s1", "s2"]);
  });
});
