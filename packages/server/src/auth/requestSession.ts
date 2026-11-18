/**
 * Resolve the player behind a request's session cookie (spec §12; M4.C04).
 *
 * Expired sessions count as absent. Account-linking routes use this to make
 * sure the credential is attached to the player who is already signed in.
 */

import type { ApiRequest } from "../api.js";
import { SESSION_COOKIE, parseCookies } from "../cookies.js";
import type { Database } from "../db/database.js";
import { loadSession } from "../db/sessionRepository.js";

export function sessionIdFromRequest(request: ApiRequest): string | undefined {
  const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  return sessionId === undefined || sessionId.length === 0 ? undefined : sessionId;
}

export function loadRequestPlayerId(
  db: Database,
  request: ApiRequest,
  now: Date = new Date(),
): string | undefined {
  const sessionId = sessionIdFromRequest(request);
  if (sessionId === undefined) {
    return undefined;
  }
  return loadSession(db, sessionId, now)?.playerId;
}
