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
  createdAt: string;
}

export interface CreateCredentialOptions {
  id: string;
  playerId: string;
  kind: CredentialKind;
  subject: string;
  secret?: string | null;
  now?: Date;
}

type CredentialRow = {
  id: string;
  player_id: string;
  kind: CredentialKind;
  subject: string;
  secret_ciphertext: string | null;
  created_at: string;
};

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    playerId: row.player_id,
    kind: row.kind,
    subject: row.subject,
    secretCiphertext: row.secret_ciphertext,
    createdAt: row.created_at,
  };
}

export function createCredential(
  db: Database,
  options: CreateCredentialOptions,
  key: Buffer,
): Credential {
  const credential: Credential = {
    id: options.id,
    playerId: options.playerId,
    kind: options.kind,
    subject: options.subject,
    secretCiphertext:
      options.secret === undefined || options.secret === null
        ? null
        : encryptSecret(options.secret, key),
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  db.run(
    `INSERT INTO credentials
       (id, player_id, kind, subject, secret_ciphertext, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    credential.id,
    credential.playerId,
    credential.kind,
    credential.subject,
    credential.secretCiphertext,
    credential.createdAt,
  );
  return credential;
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
