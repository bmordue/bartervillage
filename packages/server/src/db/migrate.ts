/**
 * Migration runner and SQLite configuration (spec §13, §14; M3.01, M3.04).
 */

import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./schema.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type { SQLiteDatabase };

export interface DatabaseOptions {
  path?: string;
  busyTimeoutMs?: number;
}

export function configureDatabase(db: SQLiteDatabase, busyTimeoutMs = 5000): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
  db.exec("PRAGMA synchronous = NORMAL");
}

export function appliedVersions(db: SQLiteDatabase): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
    version: number;
  }[];
  return rows.map((row) => row.version);
}

export function migrate(
  db: SQLiteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  const applied = new Set(appliedVersions(db));
  const ran: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      ran.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return ran;
}

export function openDatabase(options: DatabaseOptions = {}): SQLiteDatabase {
  const db = new DatabaseSync(options.path ?? ":memory:");
  configureDatabase(db, options.busyTimeoutMs);
  migrate(db);
  return db;
}
