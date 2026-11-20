/**
 * Encrypted SQLite backup (M9.05; spec §12).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "@bartervillage/server";
import {
  decryptBackup,
  encryptBackup,
  runBackup,
  snapshotDatabase,
  type BackupUpload,
  type BackupResult,
} from "../src/backup.js";

const workDir = mkdtempSync(join(tmpdir(), "bv-backup-"));
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
  } finally {
    database.close();
  }
}

let uploaded: { key: string; bytes: Buffer } | undefined;

const upload: BackupUpload = async (filePath, remoteKey) => {
  uploaded = { key: remoteKey, bytes: readFileSync(filePath) };
};

describe("backup (M9.05)", () => {
  beforeEach(() => {
    mkdirSync(workDir, { recursive: true });
    uploaded = undefined;
    for (const entry of [
      "barter-village.sqlite",
      "barter-village.sqlite-wal",
      "barter-village.sqlite-shm",
    ]) {
      rmSync(join(workDir, entry), { force: true });
    }
    seedDatabase();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("encrypts the WAL-checkpointed snapshot and uploads it under a dated key", async () => {
    const result: BackupResult = await runBackup({
      databasePath,
      workDir: join(workDir, "backups"),
      passphrase: "backup-passphrase",
      upload,
      now: () => new Date(Date.UTC(2026, 11, 31, 3, 0, 0)),
    });

    expect(result.remoteKey).toMatch(/^backups\/2026-12-31\/barter-village-.*\.enc$/);
    expect(result.snapshotBytes).toBeGreaterThan(0);
    expect(result.encryptedBytes).toBeGreaterThan(result.snapshotBytes);

    expect(uploaded?.key).toBe(result.remoteKey);
    expect(uploaded?.bytes.subarray(0, 7)).toEqual(Buffer.from("BVBAK1\0", "utf8"));
    expect(uploaded?.bytes.includes(Buffer.from("9999"))).toBe(false);

    const plaintext = decryptBackup(uploaded!.bytes, "backup-passphrase");
    expect(plaintext.subarray(0, 4).toString()).not.toBe("9999");
    writeFileSync(join(workDir, "restored.sqlite"), plaintext);
    const database = Database.open({ path: join(workDir, "restored.sqlite") });
    try {
      expect(database.get("SELECT version FROM schema_migrations WHERE version = 9999")).toEqual({
        version: 9999,
      });
    } finally {
      database.close();
    }
  });

  it("round-trips a snapshot through the encrypt and decrypt helpers", () => {
    const plaintext = Buffer.from("Barter Village snapshot payload");
    const encrypted = encryptBackup(plaintext, "backup-passphrase");
    expect(decryptBackup(encrypted, "backup-passphrase")).toEqual(plaintext);
    expect(() => decryptBackup(encrypted, "wrong-passphrase")).toThrow();
  });

  it("takes a consistent snapshot of a live database", () => {
    const snapshotPath = join(workDir, "snapshot.sqlite");
    snapshotDatabase(databasePath, snapshotPath);
    const database = Database.open({ path: snapshotPath });
    try {
      expect(database.get("SELECT version FROM schema_migrations WHERE version = 9999")).toEqual({
        version: 9999,
      });
    } finally {
      database.close();
    }
  });
});
