/**
 * Session persistence (spec §11, §12; M4.C06).
 *
 * Sessions are opaque IDs stored server-side with an absolute expiry. Lookups
 * treat an expired session as absent; logout deletes the row.
 */

import type { Database } from "./database.js";

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface Session {
  id: string;
  playerId: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateSessionOptions {
  id: string;
  playerId: string;
  now?: Date;
  ttlMs?: number;
}

type SessionRow = {
  id: string;
  player_id: string;
  created_at: string;
  expires_at: string;
};

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    playerId: row.player_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createSession(db: Database, options: CreateSessionOptions): Session {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const session: Session = {
    id: options.id,
    playerId: options.playerId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  db.run(
    "INSERT INTO sessions (id, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    session.id,
    session.playerId,
    session.createdAt,
    session.expiresAt,
  );
  return session;
}

/** Return the session only while it is unexpired. */
export function loadSession(db: Database, id: string, now: Date = new Date()): Session | undefined {
  const row = db.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", id);
  if (!row) {
    return undefined;
  }
  if (Date.parse(row.expires_at) <= now.getTime()) {
    return undefined;
  }
  return toSession(row);
}

/** Logout: remove a session if it exists. */
export function deleteSession(db: Database, id: string): boolean {
  const result = db.run("DELETE FROM sessions WHERE id = ?", id);
  return Number(result.changes) === 1;
}

/** Housekeeping for expired sessions. */
export function purgeExpiredSessions(db: Database, now: Date = new Date()): number {
  const result = db.run("DELETE FROM sessions WHERE expires_at <= ?", now.toISOString());
  return Number(result.changes);
}

export function loadPlayerSessions(db: Database, playerId: string): Session[] {
  const rows = db.all<SessionRow>(
    "SELECT * FROM sessions WHERE player_id = ? ORDER BY created_at, id",
    playerId,
  );
  return rows.map(toSession);
}
