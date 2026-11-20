/**
 * Nightly backup restore entry point (M9.06; spec §12).
 *
 * Run on a fresh VPS to restore the latest encrypted nightly backup before
 * the database is handed over to the API/worker. Secrets come from the systemd
 * environment file or the deployment environment file.
 */

import { mkdirSync } from "node:fs";

import {
  defaultBackupWorkDir,
  fetchBackup,
  restoreDatabase,
  type S3BackupConfig,
} from "./backup.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH ?? "barter-village.sqlite";
  const remoteKey = required("BACKUP_REMOTE_KEY");
  const workDir = process.env.BACKUP_WORK_DIR ?? defaultBackupWorkDir(databasePath);
  mkdirSync(workDir, { recursive: true });

  const config: S3BackupConfig = {
    endpoint: required("BACKUP_S3_ENDPOINT"),
    region: process.env.BACKUP_S3_REGION ?? "auto",
    bucket: required("BACKUP_S3_BUCKET"),
    accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY"),
  };

  const encryptedBackup = await fetchBackup(config, remoteKey);
  restoreDatabase(encryptedBackup, required("BACKUP_ENCRYPTION_PASSPHRASE"), databasePath);
  console.log(`restore: restored ${databasePath} from ${remoteKey}`);
}

main().catch((error: unknown) => {
  console.error(`restore: failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
