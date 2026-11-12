import { mkdtempSync, rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appliedVersions, migrate, openDatabase } from "../src/db/migrate.js";
import { MIGRATIONS } from "../src/db/schema.js";

const directories: string[] = [];
const databases: DatabaseSync[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "barter-migrate-"));
  directories.push(directory);
  return join(directory, "world.sqlite");
}

function open(path: string): DatabaseSync {
  const database = openDatabase({ path });
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tableNames(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function indexNames(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

describe("database migrations", () => {
  it("applies every migration to an empty database", () => {
    const database = open(databasePath());

    expect(appliedVersions(database)).toEqual(MIGRATIONS.map((migration) => migration.version));
    const rows = database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual(
      MIGRATIONS.map((migration) => ({ version: migration.version, name: migration.name })),
    );
  });

  it("is idempotent across reopens", () => {
    const path = databasePath();
    const first = open(path);
    const versions = appliedVersions(first);

    first.close();
    databases.splice(databases.indexOf(first), 1);

    const reopened = open(path);
    expect(appliedVersions(reopened)).toEqual(versions);
    expect(migrate(reopened)).toEqual([]);
  });

  it("creates the spec §13 entity tables", () => {
    const database = open(databasePath());
    const tables = tableNames(database);

    for (const table of [
      "worlds",
      "players",
      "credentials",
      "sessions",
      "invites",
      "push_subscriptions",
      "regions",
      "tiles",
      "plots",
      "buildings",
      "crops",
      "animals",
      "inventory",
      "orders",
      "order_locks",
      "ready",
      "offers",
      "wild_nodes",
      "wild_claims",
      "goals",
      "contributions",
      "goodwill",
      "decorations",
      "tick_logs",
      "archived_events",
      "avatar_paths",
    ]) {
      expect(tables.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it("indexes tick, player and board queries", () => {
    const database = open(databasePath());
    const indexes = indexNames(database);

    expect(indexes.has("archived_events_tick")).toBe(true);
    expect(indexes.has("orders_player_tick")).toBe(true);
    expect(indexes.has("offers_status_expiry")).toBe(true);
  });

  it("configures WAL, foreign keys and the busy timeout", () => {
    const database = open(databasePath());

    const journal = database.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    const busyTimeout = database.prepare("PRAGMA busy_timeout").get() as { timeout: number };

    expect(journal.journal_mode).toBe("wal");
    expect(foreignKeys.foreign_keys).toBe(1);
    expect(busyTimeout.timeout).toBe(5000);
  });
});
