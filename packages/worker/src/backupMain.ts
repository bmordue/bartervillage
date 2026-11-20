/**
 * Nightly backup entry point (M9.05; spec §12).
 *
 * Run from the worker package with `npm run backup`, or from the NixOS timer.
 * Secrets come from the systemd environment file.
 */

import { createAwsUploader, defaultBackupWorkDir, runBackup } from "./backup.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH ?? "barter-village.sqlite";
  const result = await runBackup({
    databasePath,
    workDir: process.env.BACKUP_WORK_DIR ?? defaultBackupWorkDir(databasePath),
    passphrase: required("BACKUP_ENCRYPTION_PASSPHRASE"),
    upload: createAwsUploader({
      endpoint: required("BACKUP_S3_ENDPOINT"),
      region: process.env.BACKUP_S3_REGION ?? "auto",
      bucket: required("BACKUP_S3_BUCKET"),
      accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY"),
    }),
  });
  console.log(
    `backup: uploaded ${result.remoteKey} (${result.snapshotBytes} -> ${result.encryptedBytes} bytes, sha256 ${result.checksum})`,
  );
}

main().catch((error: unknown) => {
  console.error(`backup: failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
