/**
 * Encrypted off-site backups (M9.05; spec §12).
 *
 * The backup uses SQLite's `VACUUM INTO` after a WAL checkpoint so the snapshot
 * is consistent without stopping the API. The snapshot is encrypted with
 * AES-256-GCM using a passphrase-derived key, then uploaded to S3-compatible
 * storage by the caller.
 */

import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { Database } from "@bartervillage/server";

const execFileAsync = promisify(execFile);

const MAGIC = Buffer.from("BVBAK1\0", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface BackupUpload {
  (filePath: string, remoteKey: string): Promise<void>;
}

export interface BackupOptions {
  databasePath: string;
  workDir: string;
  passphrase: string;
  upload: BackupUpload;
  now?: () => Date;
}

export interface BackupResult {
  remoteKey: string;
  checksum: string;
  snapshotBytes: number;
  encryptedBytes: number;
}

export interface S3BackupConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Take a consistent online snapshot of the live SQLite database. */
export function snapshotDatabase(databasePath: string, destination: string): void {
  rmSync(destination, { force: true });
  const database = Database.open({ path: databasePath });
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

/** Encrypt a snapshot with AES-256-GCM and a scrypt-derived key. */
export function encryptBackup(plaintext: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

/** Decrypt a backup produced by {@link encryptBackup}. */
export function decryptBackup(encrypted: Buffer, passphrase: string): Buffer {
  if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a Barter Village backup file");
  }
  let offset = MAGIC.length;
  const salt = encrypted.subarray(offset, (offset += SALT_BYTES));
  const iv = encrypted.subarray(offset, (offset += IV_BYTES));
  const tag = encrypted.subarray(offset, (offset += TAG_BYTES));
  const ciphertext = encrypted.subarray(offset);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Snapshot, encrypt and upload one backup. */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  if (options.passphrase.length === 0) {
    throw new Error("A backup passphrase is required");
  }
  mkdirSync(options.workDir, { recursive: true });
  const now = options.now?.() ?? new Date();
  const stamp = now.toISOString().replaceAll(/[:.]/g, "-");
  const snapshotPath = join(options.workDir, `barter-village-${stamp}.sqlite`);
  const encryptedPath = `${snapshotPath}.enc`;

  snapshotDatabase(options.databasePath, snapshotPath);
  const plaintext = readFileSync(snapshotPath);
  const encrypted = encryptBackup(plaintext, options.passphrase);
  writeFileSync(encryptedPath, encrypted);

  const checksum = createHash("sha256").update(encrypted).digest("hex");
  const remoteKey = `backups/${now.toISOString().slice(0, 10)}/${basename(encryptedPath)}`;
  try {
    await options.upload(encryptedPath, remoteKey);
  } finally {
    rmSync(snapshotPath, { force: true });
    rmSync(encryptedPath, { force: true });
  }

  return {
    remoteKey,
    checksum,
    snapshotBytes: plaintext.length,
    encryptedBytes: encrypted.length,
  };
}

/** Upload with the AWS CLI, which also supports S3-compatible endpoints. */
export function createAwsUploader(config: S3BackupConfig): BackupUpload {
  return async (filePath, remoteKey) => {
    await execFileAsync(
      "aws",
      [
        "s3",
        "cp",
        filePath,
        `s3://${config.bucket}/${remoteKey}`,
        "--endpoint-url",
        config.endpoint,
        "--region",
        config.region,
      ],
      {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: config.accessKeyId,
          AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
        },
      },
    );
  };
}

/** Default work directory next to the database. */
export function defaultBackupWorkDir(databasePath: string): string {
  return join(dirname(databasePath), "backups");
}
