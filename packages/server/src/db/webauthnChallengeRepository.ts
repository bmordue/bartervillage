/**
 * Short-lived WebAuthn challenge storage (spec §12; M4.C01).
 *
 * A challenge is consumed exactly once. Keeping it server-side means the
 * browser cannot choose its own challenge and a captured response cannot be
 * replayed after the first verification attempt.
 */

import type { Database } from "./database.js";

export const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;

export type WebAuthnChallengeKind = "registration" | "authentication";

export interface WebAuthnChallenge {
  id: string;
  kind: WebAuthnChallengeKind;
  challenge: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface CreateWebAuthnChallengeOptions {
  id: string;
  kind: WebAuthnChallengeKind;
  challenge: string;
  payload?: Record<string, unknown>;
  now?: Date;
  ttlMs?: number;
}

type WebAuthnChallengeRow = {
  id: string;
  kind: WebAuthnChallengeKind;
  challenge: string;
  payload_json: string;
  created_at: string;
  expires_at: string;
};

function toChallenge(row: WebAuthnChallengeRow): WebAuthnChallenge {
  return {
    id: row.id,
    kind: row.kind,
    challenge: row.challenge,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createWebAuthnChallenge(
  db: Database,
  options: CreateWebAuthnChallengeOptions,
): WebAuthnChallenge {
  const now = options.now ?? new Date();
  const challenge: WebAuthnChallenge = {
    id: options.id,
    kind: options.kind,
    challenge: options.challenge,
    payload: options.payload ?? {},
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (options.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS)).toISOString(),
  };
  db.run(
    `INSERT INTO webauthn_challenges
       (id, kind, challenge, payload_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    challenge.id,
    challenge.kind,
    challenge.challenge,
    JSON.stringify(challenge.payload),
    challenge.createdAt,
    challenge.expiresAt,
  );
  return challenge;
}

/** Delete and return a challenge; expired or mismatched challenges are discarded. */
export function consumeWebAuthnChallenge(
  db: Database,
  id: string,
  kind: WebAuthnChallengeKind,
  now: Date = new Date(),
): WebAuthnChallenge | undefined {
  return db.transaction(() => {
    const row = db.get<WebAuthnChallengeRow>("SELECT * FROM webauthn_challenges WHERE id = ?", id);
    if (!row) {
      return undefined;
    }
    db.run("DELETE FROM webauthn_challenges WHERE id = ?", id);
    if (row.kind !== kind || Date.parse(row.expires_at) <= now.getTime()) {
      return undefined;
    }
    return toChallenge(row);
  });
}

export function purgeExpiredWebAuthnChallenges(db: Database, now: Date = new Date()): number {
  const result = db.run("DELETE FROM webauthn_challenges WHERE expires_at <= ?", now.toISOString());
  return Number(result.changes);
}
