/**
 * Passkey REST endpoints (spec §12; M4.C01).
 *
 * The browser posts WebAuthn JSON here. Challenges travel in an HttpOnly
 * cookie, sessions are opaque HttpOnly cookies, and the readable CSRF token
 * follows the existing double-submit pattern.
 */

import { randomBytes } from "node:crypto";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import type { ApiRequest, JsonResponse, Routes } from "../api.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  csrfCookie,
  parseCookies,
  serializeCookie,
  sessionCookie,
} from "../cookies.js";
import type { Database } from "../db/database.js";
import { deleteSession } from "../db/sessionRepository.js";
import type { PasskeyAuth } from "./passkey.js";
import { type PasskeyError } from "./passkey.js";

export const WEBAUTHN_COOKIE = "bv_webauthn";
export const WEBAUTHN_COOKIE_PATH = "/auth/passkey";
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 5 * 60;

function challengeCookie(challengeId: string): string {
  return serializeCookie(WEBAUTHN_COOKIE, challengeId, {
    path: WEBAUTHN_COOKIE_PATH,
    maxAgeSeconds: WEBAUTHN_CHALLENGE_TTL_SECONDS,
    httpOnly: true,
    sameSite: "Strict",
  });
}

function clearChallengeCookie(): string {
  return serializeCookie(WEBAUTHN_COOKIE, "", {
    path: WEBAUTHN_COOKIE_PATH,
    maxAgeSeconds: 0,
    httpOnly: true,
    sameSite: "Strict",
  });
}

function parseBody(request: ApiRequest): Record<string, unknown> | undefined {
  if (typeof request.body !== "string" || request.body.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(request.body) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function errorStatus(reason: PasskeyError): number {
  switch (reason) {
    case "invalid_request":
    case "challenge_invalid":
      return 400;
    case "invite_invalid":
      return 403;
    case "verification_failed":
    case "credential_not_found":
    case "no_passkey":
      return 401;
    case "player_cap_reached":
    case "name_taken":
    case "site_unavailable":
      return 409;
  }
}

function errorResponse(reason: PasskeyError): JsonResponse {
  return { status: errorStatus(reason), body: { error: reason } };
}

function readChallengeId(request: ApiRequest): string | undefined {
  const value = parseCookies(request.headers.cookie)[WEBAUTHN_COOKIE];
  return value === undefined || value.length === 0 ? undefined : value;
}

function sessionHeaders(sessionId: string, csrfToken: string): Record<string, string[]> {
  return {
    "set-cookie": [sessionCookie(sessionId), csrfCookie(csrfToken), clearChallengeCookie()],
  };
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { rawId?: unknown }).rawId === "string"
  );
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  return isRegistrationResponse(value);
}

export function createPasskeyRoutes(db: Database, auth: PasskeyAuth): Routes {
  return {
    "POST /auth/passkey/register/options": async (request) => {
      const body = parseBody(request);
      if (
        body === undefined ||
        typeof body.inviteCode !== "string" ||
        typeof body.name !== "string" ||
        typeof body.plotId !== "string"
      ) {
        return errorResponse("invalid_request");
      }
      const result = await auth.startRegistration(db, {
        inviteCode: body.inviteCode,
        name: body.name,
        plotId: body.plotId,
      });
      if (!result.ok) {
        return errorResponse(result.reason);
      }
      return {
        status: 200,
        body: { options: result.options },
        headers: { "set-cookie": [challengeCookie(result.challengeId)] },
      };
    },

    "POST /auth/passkey/register/verify": async (request) => {
      const challengeId = readChallengeId(request);
      const body = parseBody(request);
      if (
        challengeId === undefined ||
        body === undefined ||
        !isRegistrationResponse(body.response)
      ) {
        return errorResponse("invalid_request");
      }
      const result = await auth.finishRegistration(db, challengeId, body.response);
      if (!result.ok) {
        return errorResponse(result.reason);
      }
      const csrfToken = randomBytes(24).toString("base64url");
      return {
        status: 200,
        body: {
          playerId: result.playerId,
          plotId: result.plotId,
          csrfToken,
        },
        headers: sessionHeaders(result.session.id, csrfToken),
      };
    },

    "POST /auth/passkey/login/options": async (request) => {
      const body = parseBody(request);
      if (
        body === undefined ||
        (body.playerId !== undefined && typeof body.playerId !== "string")
      ) {
        return errorResponse("invalid_request");
      }
      const result = await auth.startAuthentication(db, {
        ...(typeof body.playerId === "string" ? { playerId: body.playerId } : {}),
      });
      if (!result.ok) {
        return errorResponse(result.reason);
      }
      return {
        status: 200,
        body: { options: result.options },
        headers: { "set-cookie": [challengeCookie(result.challengeId)] },
      };
    },

    "POST /auth/passkey/login/verify": async (request) => {
      const challengeId = readChallengeId(request);
      const body = parseBody(request);
      if (
        challengeId === undefined ||
        body === undefined ||
        !isAuthenticationResponse(body.response)
      ) {
        return errorResponse("invalid_request");
      }
      const result = await auth.finishAuthentication(db, challengeId, body.response);
      if (!result.ok) {
        return errorResponse(result.reason);
      }
      const csrfToken = randomBytes(24).toString("base64url");
      return {
        status: 200,
        body: { playerId: result.playerId, csrfToken },
        headers: sessionHeaders(result.session.id, csrfToken),
      };
    },

    "POST /auth/logout": (request) => {
      const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (sessionId !== undefined) {
        deleteSession(db, sessionId);
      }
      return {
        status: 200,
        body: { ok: true },
        headers: {
          "set-cookie": [
            serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 }),
            serializeCookie(CSRF_COOKIE, "", { maxAgeSeconds: 0, httpOnly: false }),
          ],
        },
      };
    },
  };
}
