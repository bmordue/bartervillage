/**
 * Short-lived OAuth authorization state (spec §12; M4.C02).
 *
 * The state ID is echoed to the provider and compared against an HttpOnly
 * cookie, so a callback cannot be replayed or injected from another browser.
 * The PKCE verifier and pending onboarding details live server-side only.
 */

import type { Database } from "./database.js";

export const OAUTH_PROVIDERS = ["discord", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type OAuthPurpose = "login" | "onboard" | "link";

export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface OAuthState {
  id: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  payload: Record<string, unknown>;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOAuthStateOptions {
  id: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  payload?: Record<string, unknown>;
  codeVerifier: string;
  now?: Date;
  ttlMs?: number;
}

type OAuthStateRow = {
  id: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  payload_json: string;
  code_verifier: string;
  created_at: string;
  expires_at: string;
};

function parsePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toState(row: OAuthStateRow): OAuthState {
  return {
    id: row.id,
    provider: row.provider,
    purpose: row.purpose,
    payload: parsePayload(row.payload_json),
    codeVerifier: row.code_verifier,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createOAuthState(db: Database, options: CreateOAuthStateOptions): OAuthState {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_OAUTH_STATE_TTL_MS;
  const state: OAuthState = {
    id: options.id,
    provider: options.provider,
    purpose: options.purpose,
    payload: options.payload ?? {},
    codeVerifier: options.codeVerifier,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  db.run(
    `INSERT INTO oauth_states
       (id, provider, purpose, payload_json, code_verifier, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    state.id,
    state.provider,
    state.purpose,
    JSON.stringify(state.payload),
    state.codeVerifier,
    state.createdAt,
    state.expiresAt,
  );
  return state;
}

/** Consume a state exactly once, rejecting an expired or mismatched provider. */
export function consumeOAuthState(
  db: Database,
  id: string,
  provider: OAuthProvider,
  now: Date = new Date(),
): OAuthState | undefined {
  return db.transaction(() => {
    const row = db.get<OAuthStateRow>("SELECT * FROM oauth_states WHERE id = ?", id);
    if (!row || row.provider !== provider) {
      return undefined;
    }
    db.run("DELETE FROM oauth_states WHERE id = ?", id);
    if (Date.parse(row.expires_at) <= now.getTime()) {
      return undefined;
    }
    return toState(row);
  });
}

export function purgeExpiredOAuthStates(db: Database, now: Date = new Date()): number {
  const result = db.run("DELETE FROM oauth_states WHERE expires_at <= ?", now.toISOString());
  return Number(result.changes);
}
