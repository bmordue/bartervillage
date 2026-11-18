/**
 * Discord OAuth REST endpoints (spec §12; M4.C02).
 *
 * `/auth/discord/login` starts the authorization-code flow and redirects to
 * Discord. `/auth/discord/callback` verifies the browser-bound state, creates
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
import { type DiscordAuth, type DiscordError, type StartDiscordLoginInput } from "./discord.js";
import { loadRequestPlayerId } from "./requestSession.js";

export const DISCORD_STATE_COOKIE = "bv_discord";
export const DISCORD_STATE_COOKIE_PATH = "/auth/discord";
export const DISCORD_STATE_TTL_SECONDS = 10 * 60;

function stateCookie(stateId: string): string {
  return serializeCookie(DISCORD_STATE_COOKIE, stateId, {
    path: DISCORD_STATE_COOKIE_PATH,
    maxAgeSeconds: DISCORD_STATE_TTL_SECONDS,
    httpOnly: true,
    sameSite: "Lax",
  });
}

function clearStateCookie(): string {
  return serializeCookie(DISCORD_STATE_COOKIE, "", {
    path: DISCORD_STATE_COOKIE_PATH,
    maxAgeSeconds: 0,
    httpOnly: true,
    sameSite: "Lax",
  });
}

function errorStatus(reason: DiscordError): number {
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
    case "credential_taken":
      return 409;
    case "provider_error":
      return 502;
  }
}

function errorResponse(reason: DiscordError): JsonResponse {
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

function startInput(request: ApiRequest): StartDiscordLoginInput {
  const input: StartDiscordLoginInput = {};
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

export function createDiscordRoutes(db: Database, auth: DiscordAuth): Routes {
  return {
    "GET /auth/discord/login": (request) => {
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

    "GET /auth/discord/link": (request) => {
      const playerId = loadRequestPlayerId(db, request);
      if (playerId === undefined) {
        return {
          status: 401,
          body: { error: "not_authenticated" },
          headers: { "set-cookie": [clearStateCookie()] },
        };
      }
      const result = auth.startLogin(db, { ...startInput(request), linkPlayerId: playerId });
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

    "GET /auth/discord/callback": async (request) => {
      const stateId = readQuery(request, "state");
      const code = readQuery(request, "code");
      const cookieState = parseCookies(request.headers.cookie)[DISCORD_STATE_COOKIE];
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
