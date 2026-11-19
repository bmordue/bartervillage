/**
 * End-to-end harness support (CT.06).
 *
 * Seeds a world with a generated map and an invite, then walks a new player
 * through the real passkey registration endpoints so tests can exercise
 * onboarding, ordering, tick resolution and replay playback in one flow.
 */

import type { RegistrationResponseJSON, verifyRegistrationResponse } from "@simplewebauthn/server";

import { content } from "@bartervillage/content";
import { generateRegion, MAP_GENERATOR_VERSION, RULES_VERSION } from "@bartervillage/rules";

import { PasskeyAuth } from "../../src/auth/passkey.js";
import { WEBAUTHN_COOKIE } from "../../src/auth/passkeyRoutes.js";
import type { Database } from "../../src/db/database.js";
import { createInviteCode, hashInviteCode, issueInvite } from "../../src/db/inviteRepository.js";
import { persistMap } from "../../src/db/mapRepository.js";

export const registrationResponse = {
  id: "e2e-credential",
  rawId: "e2e-credential",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
  },
} as RegistrationResponseJSON;

const verifiedRegistration = (async () => ({
  verified: true as const,
  registrationInfo: {
    fmt: "none",
    aaguid: "00000000-0000-0000-0000-000000000000",
    credential: {
      id: "e2e-credential",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ["internal"],
    },
    credentialType: "public-key" as const,
    attestationObject: new Uint8Array(),
    userVerified: true,
    credentialDeviceType: "multiDevice" as const,
    credentialBackedUp: true,
    origin: "http://localhost:3000",
  },
})) as unknown as typeof verifyRegistrationResponse;

export function createTestPasskey(): PasskeyAuth {
  return new PasskeyAuth({
    rpID: "localhost",
    rpName: "Barter Village",
    origins: "http://localhost:3000",
    now: () => new Date(),
    verifyRegistration: verifiedRegistration,
  });
}

export interface E2eSeed {
  worldId: string;
  inviteCode: string;
  plotId: string;
}

export function seedE2eWorld(database: Database): E2eSeed {
  const worldId = "w1";
  const seed = "e2e-seed";
  database.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, current_tick, season, weather)
     VALUES (?, ?, ?, ?, ?, '20:00', 'UTC', 60, 20, 0, 'spring', 'clear')`,
    worldId,
    seed,
    MAP_GENERATOR_VERSION,
    content.version,
    RULES_VERSION,
  );

  const generated = generateRegion(seed, MAP_GENERATOR_VERSION, 0, 0, content);
  persistMap(database, [generated]);
  const site = generated.plots.find((plot) => !plot.worldOwned);
  if (!site) {
    throw new Error("Generated region has no player plot");
  }

  const inviteCode = createInviteCode();
  issueInvite(database, { id: "invite-e2e", codeHash: hashInviteCode(inviteCode) });
  return { worldId, inviteCode, plotId: site.id };
}

export interface E2ePlayer {
  playerId: string;
  plotId: string;
  sessionCookie: string;
  csrfToken: string;
}

function cookieValue(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.split("=")[1];
}

/** Register a new player through the passkey REST endpoints. */
export async function onboardViaPasskey(baseUrl: string, seed: E2eSeed): Promise<E2ePlayer> {
  const optionsResponse = await fetch(`${baseUrl}/auth/passkey/register/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inviteCode: seed.inviteCode,
      name: "E2E Player",
      plotId: seed.plotId,
    }),
  });
  if (optionsResponse.status !== 200) {
    throw new Error(`register/options failed with ${optionsResponse.status}`);
  }
  const challengeId = cookieValue(optionsResponse, WEBAUTHN_COOKIE);
  if (!challengeId) {
    throw new Error("register/options returned no challenge cookie");
  }

  const verifyResponse = await fetch(`${baseUrl}/auth/passkey/register/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${WEBAUTHN_COOKIE}=${challengeId}`,
    },
    body: JSON.stringify({ response: registrationResponse }),
  });
  if (verifyResponse.status !== 200) {
    throw new Error(`register/verify failed with ${verifyResponse.status}`);
  }
  const body = (await verifyResponse.json()) as {
    playerId: string;
    plotId: string;
    csrfToken: string;
  };
  const sessionCookie = cookieValue(verifyResponse, "bv_session");
  if (!sessionCookie) {
    throw new Error("register/verify returned no session cookie");
  }

  return {
    playerId: body.playerId,
    plotId: body.plotId,
    sessionCookie,
    csrfToken: body.csrfToken,
  };
}
