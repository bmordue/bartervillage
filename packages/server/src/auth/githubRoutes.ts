/**
 * GitHub OAuth REST endpoints (spec §12; M4.C03).
 *
 * `/auth/github/login` starts the authorization-code flow and redirects to
 * GitHub. `/auth/github/callback` verifies the browser-bound state, creates
 * the session and redirects back to the client.
 */

import { randomBytes } from "node:crypto";

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
import { type GithubAuth, type GithubError, type StartGithubLoginInput } from "./github.js";

export const GITHUB_STATE_COOKIE = "bv_github";
export const GITHUB_STATE_COOKIE_PATH = "/auth/github";
export const GITHUB_STATE_TTL_SECONDS = 10 * 60;

function stateCookie(stateId: string): string {
  return serializeCookie(GITHUB_STATE_COOKIE, stateId, {
    path: GITHUB_STATE_COOKIE_PATH,
    maxAgeSeconds: GITHUB_STATE_TTL_SECONDS,
    httpOnly: true,
    sameSite: "Lax",
  });
}

function clearStateCookie(): string {
  return serializeCookie(GITHUB_STATE_COOKIE, "", {
    path: GITHUB_STATE_COOKIE_PATH,
    maxAgeSeconds: 0,
    httpOnly: true,
    sameSite: "Lax",
  });
}

function errorStatus(reason: GithubError): number {
  switch (reason) {
    case "invalid_request":
    case "state_invalid":
      return 400;
    case "invite_invalid":
    case "account_not_found":
      return 403;
    case "player_cap_reached":
    case "name_taken":
    case "site_unavailable":
      return 409;
    case "provider_error":
      return 502;
  }
}

function errorResponse(reason: GithubError): JsonResponse {
  return {
    status: errorStatus(reason),
    body: { error: reason },
    headers: { "set-cookie": [clearStateCookie()] },
  };
}

function readQuery(request: ApiRequest, key: string): string | undefined {
  const value = request.query?.[key];
  return typeof value === "string" ? value : undefined;
}

function startInput(request: ApiRequest): StartGithubLoginInput {
  const input: StartGithubLoginInput = {};
  const inviteCode = readQuery(request, "inviteCode");
  const name = readQuery(request, "name");
  const plotId = readQuery(request, "plotId");
  if (inviteCode !== undefined) {
    input.inviteCode = inviteCode;
  }
  if (name !== undefined) {
    input.name = name;
  }
  if (plotId !== undefined) {
    input.plotId = plotId;
  }
  return input;
}

export function createGithubRoutes(db: Database, auth: GithubAuth): Routes {
  return {
    "GET /auth/github/login": (request) => {
      const result = auth.startLogin(db, startInput(request));
      if (!result.ok) {
        return errorResponse(result.reason);
      }
      return {
        status: 302,
        body: undefined,
        headers: {
          location: result.authorizationUrl,
          "set-cookie": [stateCookie(result.stateId)],
        },
      };
    },

    "GET /auth/github/callback": async (request) => {
      const stateId = readQuery(request, "state");
      const code = readQuery(request, "code");
      const cookieState = parseCookies(request.headers.cookie)[GITHUB_STATE_COOKIE];
      if (
        stateId === undefined ||
        stateId.length === 0 ||
        code === undefined ||
        code.length === 0 ||
        cookieState !== stateId
      ) {
        return errorResponse("state_invalid");
      }

      const result = await auth.finishLogin(db, stateId, code);
      if (!result.ok) {
        return errorResponse(result.reason);
      }

      const csrfToken = randomBytes(24).toString("base64url");
      return {
        status: 302,
        body: undefined,
        headers: {
          location: auth.successRedirect,
          "set-cookie": [
            sessionCookie(result.session.id),
            csrfCookie(csrfToken),
            clearStateCookie(),
          ],
        },
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
