/**
 * Restore round-trip test (M9.06; spec §3).
 *
 * Verifies that an encrypted backup can be restored to a fresh SQLite
 * database and that the restored database is valid for tick resolution.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "@bartervillage/server";
import { decryptBackup, encryptBackup, restoreDatabase, snapshotDatabase } from "../src/backup.js";

const workDir = mkdtempSync(join(tmpdir(), "bv-restore-"));
const databasePath = join(workDir, "barter-village.sqlite");

function seedDatabase(): void {
  const database = Database.open({ path: databasePath });
  try {
    database.run(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      9999,
      "test-migration",
      new Date().toISOString(),
    );
    database.run(
      "INSERT INTO worlds (id, seed, generator_version, content_version, rules_version, deadline_time, timezone, min_tick_gap_minutes, player_cap, current_tick, season, weather, next_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "w1",
      "test-seed",
      "1",
      "1",
      "1",
      "20:00:00.000Z",
      "UTC",
      60,
      20,
      0,
      "spring",
      "sun",
      "2026-12-01T20:00:00Z",
    );
    database.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy, default_harvest, default_water, default_feed, default_tend) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "p1",
      "Test Player",
      "plot1",
      0,
      100,
      1,
      1,
      1,
      0,
    );
  } finally {
    database.close();
  }
}

describe("restore round-trip (M9.06)", () => {
  beforeEach(() => {
    mkdirSync(workDir, { recursive: true });
    seedDatabase();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("restores an encrypted backup to a fresh SQLite database with intact data", async () => {
    const snapshotPath = join(workDir, "snapshot.sqlite");
    snapshotDatabase(databasePath, snapshotPath);
    const plaintext = readFileSync(snapshotPath);
    const encrypted = encryptBackup(plaintext, "backup-passphrase");

    const restoredPath = join(workDir, "restored.sqlite");
    restoreDatabase(encrypted, "backup-passphrase", restoredPath);

    const restoredDb = Database.open({ path: restoredPath });
    try {
      expect(restoredDb.get("SELECT version FROM schema_migrations WHERE version = 9999")).toEqual({
        version: 9999,
      });
      expect(
        restoredDb.get("SELECT current_tick, season, weather FROM worlds WHERE id = 'w1'"),
      ).toEqual({
        current_tick: 0,
        season: "spring",
        weather: "sun",
      });
      expect(
        restoredDb.get(
          "SELECT energy, joined_tick, default_harvest, default_water, default_feed, default_tend FROM players WHERE id = 'p1'",
        ),
      ).toEqual({
        energy: 100,
        joined_tick: 0,
        default_harvest: 1,
        default_water: 1,
        default_feed: 1,
        default_tend: 0,
      });
    } finally {
      restoredDb.close();
    }
  });

  it("rejects decryption with the wrong passphrase", async () => {
    const snapshotPath = join(workDir, "snapshot.sqlite");
    snapshotDatabase(databasePath, snapshotPath);
    const plaintext = readFileSync(snapshotPath);
    const encrypted = encryptBackup(plaintext, "backup-passphrase");

    expect(() => decryptBackup(encrypted, "wrong-passphrase")).toThrow();
  });

  it("preserves the database schema after a full backup-restore cycle", async () => {
    const encrypted = encryptBackup(readFileSync(databasePath), "backup-passphrase");
    const restoredPath = join(workDir, "restored.sqlite");
    restoreDatabase(encrypted, "backup-passphrase", restoredPath);

    const restoredDb = Database.open({ path: restoredPath });
    try {
      const tables = restoredDb.all("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = (tables as Array<{ name: string }>).map((row) => row.name).sort();
      expect(tableNames).toContain("schema_migrations");
      expect(tableNames).toContain("worlds");
      expect(tableNames).toContain("players");
    } finally {
      restoredDb.close();
    }
  });
});
