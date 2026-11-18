/**
 * Credential persistence (spec §12; M4.B09).
 *
 * External identities are keyed by `(kind, subject)`. Any token or secret is
 * encrypted with AES-256-GCM before storage; the plaintext is only produced on
 * an explicit load that supplies the key. There is deliberately no password
 * field anywhere in this model.
 */

import { decryptSecret, encryptSecret } from "../crypto.js";
import type { Database } from "./database.js";

export const CREDENTIAL_KINDS = ["passkey", "discord", "github"] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export interface Credential {
  id: string;
  playerId: string;
  kind: CredentialKind;
  subject: string;
  secretCiphertext: string | null;
  publicKey: string | null;
  counter: number;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
}

export interface CreateCredentialOptions {
  id: string;
  playerId: string;
  kind: CredentialKind;
  subject: string;
  secret?: string | null;
  publicKey?: string | null;
  counter?: number;
  transports?: string[];
  deviceType?: string | null;
  backedUp?: boolean;
  now?: Date;
}

type CredentialRow = {
  id: string;
  player_id: string;
  kind: CredentialKind;
  subject: string;
  secret_ciphertext: string | null;
  public_key: string | null;
  counter: number;
  transports_json: string | null;
  device_type: string | null;
  backed_up: number;
  created_at: string;
};

function parseTransports(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
    ? (parsed as string[])
    : [];
}

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    playerId: row.player_id,
    kind: row.kind,
    subject: row.subject,
    secretCiphertext: row.secret_ciphertext,
    publicKey: row.public_key,
    counter: row.counter,
    transports: parseTransports(row.transports_json),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at,
  };
}

export function createCredential(
  db: Database,
  options: CreateCredentialOptions,
  key?: Buffer,
): Credential {
  const hasSecret = options.secret !== undefined && options.secret !== null;
  if (hasSecret && key === undefined) {
    throw new Error("A credential key is required to store a secret");
  }
  const credential: Credential = {
    id: options.id,
    playerId: options.playerId,
    kind: options.kind,
    subject: options.subject,
    secretCiphertext: hasSecret ? encryptSecret(options.secret as string, key as Buffer) : null,
    publicKey: options.publicKey ?? null,
    counter: options.counter ?? 0,
    transports: options.transports ?? [],
    deviceType: options.deviceType ?? null,
    backedUp: options.backedUp ?? false,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  db.run(
    `INSERT INTO credentials
       (id, player_id, kind, subject, secret_ciphertext, public_key, counter,
        transports_json, device_type, backed_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    credential.id,
    credential.playerId,
    credential.kind,
    credential.subject,
    credential.secretCiphertext,
    credential.publicKey,
    credential.counter,
    JSON.stringify(credential.transports),
    credential.deviceType,
    credential.backedUp ? 1 : 0,
    credential.createdAt,
  );
  return credential;
}

export interface UpdatePasskeyCredentialOptions {
  counter: number;
  transports?: string[];
  deviceType?: string | null;
  backedUp?: boolean;
}

export function updatePasskeyCredential(
  db: Database,
  id: string,
  options: UpdatePasskeyCredentialOptions,
): boolean {
  const result = db.run(
    `UPDATE credentials
     SET counter = ?,
         transports_json = COALESCE(?, transports_json),
         device_type = COALESCE(?, device_type),
         backed_up = COALESCE(?, backed_up)
     WHERE id = ? AND kind = 'passkey'`,
    options.counter,
    options.transports === undefined ? null : JSON.stringify(options.transports),
    options.deviceType ?? null,
    options.backedUp === undefined ? null : options.backedUp ? 1 : 0,
    id,
  );
  return Number(result.changes) === 1;
}

/** Replace the encrypted token set on an OAuth credential. */
export function updateCredentialSecret(
  db: Database,
  id: string,
  secret: string,
  key: Buffer,
): boolean {
  const result = db.run(
    "UPDATE credentials SET secret_ciphertext = ? WHERE id = ?",
    encryptSecret(secret, key),
    id,
  );
  return Number(result.changes) === 1;
}

export function loadCredential(db: Database, id: string): Credential | undefined {
  const row = db.get<CredentialRow>("SELECT * FROM credentials WHERE id = ?", id);
  return row ? toCredential(row) : undefined;
}

export function findCredentialBySubject(
  db: Database,
  kind: CredentialKind,
  subject: string,
): Credential | undefined {
  const row = db.get<CredentialRow>(
    "SELECT * FROM credentials WHERE kind = ? AND subject = ?",
    kind,
    subject,
  );
  return row ? toCredential(row) : undefined;
}

export function listPlayerCredentials(db: Database, playerId: string): Credential[] {
  const rows = db.all<CredentialRow>(
    "SELECT * FROM credentials WHERE player_id = ? ORDER BY created_at, id",
    playerId,
  );
  return rows.map(toCredential);
}

/** Decrypt the stored secret; returns null when the credential has none. */
export function loadCredentialSecret(
  db: Database,
  id: string,
  key: Buffer,
): string | null | undefined {
  const credential = loadCredential(db, id);
  if (credential === undefined) {
    return undefined;
  }
  if (credential.secretCiphertext === null) {
    return null;
  }
  return decryptSecret(credential.secretCiphertext, key);
}

export function deleteCredential(db: Database, id: string): boolean {
  const result = db.run("DELETE FROM credentials WHERE id = ?", id);
  return Number(result.changes) === 1;
}
