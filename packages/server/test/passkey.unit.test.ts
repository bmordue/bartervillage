import { afterEach, describe, expect, it } from "vitest";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import { PasskeyAuth, passkeyOptionsFromEnv } from "../src/auth/passkey.js";
import { WEBAUTHN_COOKIE } from "../src/auth/passkeyRoutes.js";
import { buildApiRoutes } from "../src/api.js";
import { Database } from "../src/db/database.js";
import {
  consumeWebAuthnChallenge,
  createWebAuthnChallenge,
  purgeExpiredWebAuthnChallenges,
} from "../src/db/webauthnChallengeRepository.js";
import { findCredentialBySubject, loadCredential } from "../src/db/credentialRepository.js";
import { createInviteCode, hashInviteCode, issueInvite } from "../src/db/inviteRepository.js";
import { loadSession } from "../src/db/sessionRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

const registrationResponse = {
  id: "credential-id",
  rawId: "credential-id",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
  },
} as RegistrationResponseJSON;

const authenticationResponse = {
  id: "credential-id",
  rawId: "credential-id",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    authenticatorData: "authenticator-data",
    signature: "signature",
  },
} as AuthenticationResponseJSON;

const verifiedRegistration = (async () => ({
  verified: true as const,
  registrationInfo: {
    fmt: "none",
    aaguid: "00000000-0000-0000-0000-000000000000",
    credential: {
      id: "credential-id",
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

const verifiedAuthentication = (async () => ({
  verified: true,
  authenticationInfo: {
    credentialID: "credential-id",
    newCounter: 7,
    userVerified: true,
    credentialDeviceType: "multiDevice",
    credentialBackedUp: true,
    origin: "http://localhost:3000",
    rpID: "localhost",
  },
})) as unknown as typeof verifyAuthenticationResponse;

let db: Database | undefined;
let harness: TestApi | undefined;

afterEach(async () => {
  db?.close();
  db = undefined;
  await harness?.close();
  harness = undefined;
});

function seed(database: Database): { inviteCode: string; plotId: string } {
  insertWorld(database);
  database.run("INSERT INTO regions (id, x, y, width, height) VALUES ('r1', 0, 0, 12, 12)");
  database.run(
    `INSERT INTO plots (id, player_id, region_id, site_x, site_y, width, height)
     VALUES ('plot-1', NULL, 'r1', 0, 0, 12, 12)`,
  );
  const inviteCode = createInviteCode();
  issueInvite(database, { id: "invite-1", codeHash: hashInviteCode(inviteCode) });
  return { inviteCode, plotId: "plot-1" };
}

function setup(): { database: Database; inviteCode: string; plotId: string } {
  const database = Database.open();
  db = database;
  return { database, ...seed(database) };
}

function auth(overrides: Partial<ConstructorParameters<typeof PasskeyAuth>[0]> = {}): PasskeyAuth {
  return new PasskeyAuth({
    rpID: "localhost",
    rpName: "Barter Village",
    origins: "http://localhost:3000",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    verifyRegistration: verifiedRegistration,
    verifyAuthentication: verifiedAuthentication,
    ...overrides,
  });
}

describe("WebAuthn challenges", () => {
  it("can be consumed once and never after expiry", () => {
    const database = Database.open();
    db = database;
    createWebAuthnChallenge(database, {
      id: "c1",
      kind: "registration",
      challenge: "challenge",
      payload: { playerId: "p1" },
      now: new Date("2026-01-01T00:00:00.000Z"),
      ttlMs: 60_000,
    });

    const consumed = consumeWebAuthnChallenge(
      database,
      "c1",
      "registration",
      new Date("2026-01-01T00:00:30.000Z"),
    );
    expect(consumed?.challenge).toBe("challenge");
    expect(consumed?.payload).toEqual({ playerId: "p1" });
    expect(
      consumeWebAuthnChallenge(
        database,
        "c1",
        "registration",
        new Date("2026-01-01T00:00:30.000Z"),
      ),
    ).toBeUndefined();

    createWebAuthnChallenge(database, {
      id: "c2",
      kind: "authentication",
      challenge: "expired",
      now: new Date("2026-01-01T00:00:00.000Z"),
      ttlMs: 1000,
    });
    expect(
      consumeWebAuthnChallenge(
        database,
        "c2",
        "authentication",
        new Date("2026-01-01T00:00:02.000Z"),
      ),
    ).toBeUndefined();
    expect(purgeExpiredWebAuthnChallenges(database, new Date("2026-01-01T00:00:02.000Z"))).toBe(0);
  });
});

describe("passkey registration", () => {
  it("creates a player, public-key credential and session after verification", async () => {
    const { database, inviteCode, plotId } = setup();
    const passkey = auth();

    const started = await passkey.startRegistration(database, {
      inviteCode,
      name: "Ada",
      plotId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.options.rp.id).toBe("localhost");
    expect(started.options.user.name).toBe("Ada");

    const finished = await passkey.finishRegistration(
      database,
      started.challengeId,
      registrationResponse,
    );
    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    const player = database.get<{ name: string; plot_id: string }>(
      "SELECT name, plot_id FROM players WHERE id = ?",
      finished.playerId,
    );
    expect(player).toEqual({ name: "Ada", plot_id: plotId });

    const credential = findCredentialBySubject(database, "passkey", "credential-id");
    expect(credential).toBeDefined();
    expect(credential?.publicKey).toBe(Buffer.from([1, 2, 3, 4]).toString("base64url"));
    expect(credential?.transports).toEqual(["internal"]);
    expect(credential?.backedUp).toBe(true);
    expect(loadCredential(database, credential?.id ?? "")?.counter).toBe(0);
    expect(
      loadSession(database, finished.session.id, new Date("2026-01-02T00:00:00.000Z"))?.playerId,
    ).toBe(finished.playerId);

    const invite = database.get<{ redeemed_by_player_id: string | null }>(
      "SELECT redeemed_by_player_id FROM invites WHERE id = 'invite-1'",
    );
    expect(invite?.redeemed_by_player_id).toBe(finished.playerId);
    expect(
      database.get<{ id: string }>(
        "SELECT id FROM webauthn_challenges WHERE id = ?",
        started.challengeId,
      ),
    ).toBeUndefined();
  });

  it("rejects an unknown or reused challenge", async () => {
    const { database, inviteCode, plotId } = setup();
    const passkey = auth();

    const started = await passkey.startRegistration(database, {
      inviteCode,
      name: "Ada",
      plotId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await passkey.finishRegistration(database, started.challengeId, registrationResponse);

    const reused = await passkey.finishRegistration(
      database,
      started.challengeId,
      registrationResponse,
    );
    expect(reused).toEqual({ ok: false, reason: "challenge_invalid" });
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(1);
  });

  it("rejects bad invites, taken names and unavailable sites", async () => {
    const { database, inviteCode, plotId } = setup();
    const passkey = auth();

    expect(
      await passkey.startRegistration(database, {
        inviteCode: "wrong",
        name: "Ada",
        plotId,
      }),
    ).toEqual({ ok: false, reason: "invite_invalid" });

    database.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'Ada', 'other', 0, 100)",
    );
    expect(await passkey.startRegistration(database, { inviteCode, name: "Ada", plotId })).toEqual({
      ok: false,
      reason: "name_taken",
    });

    expect(
      await passkey.startRegistration(database, {
        inviteCode,
        name: "Grace",
        plotId: "missing-plot",
      }),
    ).toEqual({ ok: false, reason: "site_unavailable" });
  });

  it("rejects a failed verification without creating a player", async () => {
    const { database, inviteCode, plotId } = setup();
    const passkey = auth({
      verifyRegistration: (async () => ({
        verified: false as const,
      })) as unknown as typeof verifyRegistrationResponse,
    });

    const started = await passkey.startRegistration(database, {
      inviteCode,
      name: "Ada",
      plotId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(
      await passkey.finishRegistration(database, started.challengeId, registrationResponse),
    ).toEqual({ ok: false, reason: "verification_failed" });
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(0);
  });
});

describe("passkey login", () => {
  it("authenticates an existing passkey, updates the counter and creates a session", async () => {
    const { database, inviteCode, plotId } = setup();
    const passkey = auth();
    const started = await passkey.startRegistration(database, {
      inviteCode,
      name: "Ada",
      plotId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const registered = await passkey.finishRegistration(
      database,
      started.challengeId,
      registrationResponse,
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      return;
    }

    const options = await passkey.startAuthentication(database, {
      playerId: registered.playerId,
    });
    expect(options.ok).toBe(true);
    if (!options.ok) {
      return;
    }
    expect(options.options.allowCredentials?.[0]?.id).toBe("credential-id");

    const loggedIn = await passkey.finishAuthentication(
      database,
      options.challengeId,
      authenticationResponse,
    );
    expect(loggedIn.ok).toBe(true);
    if (!loggedIn.ok) {
      return;
    }
    expect(loggedIn.playerId).toBe(registered.playerId);
    expect(
      loadSession(database, loggedIn.session.id, new Date("2026-01-02T00:00:00.000Z"))?.playerId,
    ).toBe(registered.playerId);
    expect(findCredentialBySubject(database, "passkey", "credential-id")?.counter).toBe(7);
  });

  it("refuses a player without a passkey and an unregistered credential", async () => {
    const { database } = setup();
    const passkey = auth();

    expect(await passkey.startAuthentication(database, { playerId: "ghost" })).toEqual({
      ok: false,
      reason: "no_passkey",
    });

    const options = await passkey.startAuthentication(database, {});
    expect(options.ok).toBe(true);
    if (!options.ok) {
      return;
    }
    expect(
      await passkey.finishAuthentication(database, options.challengeId, authenticationResponse),
    ).toEqual({ ok: false, reason: "credential_not_found" });
  });
});

describe("passkey REST routes", () => {
  it("registers and logs in over HTTP with HttpOnly cookies", async () => {
    const passkey = auth();
    harness = await startTestApi({
      buildRoutes: (testDatabase) => buildApiRoutes(testDatabase, { passkey }),
    });
    const setupData = seed(harness.database);

    const optionsResponse = await fetch(`${harness.baseUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inviteCode: setupData.inviteCode,
        name: "Ada",
        plotId: setupData.plotId,
      }),
    });
    expect(optionsResponse.status).toBe(200);
    const optionsBody = (await optionsResponse.json()) as { options: unknown };
    expect(optionsBody.options).toBeDefined();
    const challengeCookie = optionsResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${WEBAUTHN_COOKIE}=`));
    expect(challengeCookie).toContain("HttpOnly");

    const challengeId = challengeCookie?.split(";")[0]?.split("=")[1] ?? "";
    const verifyResponse = await fetch(`${harness.baseUrl}/auth/passkey/register/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${WEBAUTHN_COOKIE}=${challengeId}`,
      },
      body: JSON.stringify({ response: registrationResponse }),
    });
    expect(verifyResponse.status).toBe(200);
    const registered = (await verifyResponse.json()) as { playerId: string; csrfToken: string };
    expect(registered.playerId).toMatch(/^player-/);
    expect(registered.csrfToken.length).toBeGreaterThan(10);
    const cookies = verifyResponse.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("bv_session="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("bv_csrf="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith(`${WEBAUTHN_COOKIE}=;`))).toBe(true);

    const loginOptionsResponse = await fetch(`${harness.baseUrl}/auth/passkey/login/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: registered.playerId }),
    });
    expect(loginOptionsResponse.status).toBe(200);
    const loginChallenge = loginOptionsResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${WEBAUTHN_COOKIE}=`))
      ?.split(";")[0]
      ?.split("=")[1];
    const loginResponse = await fetch(`${harness.baseUrl}/auth/passkey/login/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${WEBAUTHN_COOKIE}=${loginChallenge ?? ""}`,
      },
      body: JSON.stringify({ response: authenticationResponse }),
    });
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toMatchObject({ playerId: registered.playerId });
  });
});

describe("passkey environment", () => {
  it("requires HTTPS origins in production", () => {
    expect(() =>
      passkeyOptionsFromEnv({
        NODE_ENV: "production",
        BARTER_RP_ID: "barter.example",
        BARTER_ORIGIN: "http://barter.example",
      }),
    ).toThrow(/HTTPS/);

    expect(
      passkeyOptionsFromEnv({
        NODE_ENV: "production",
        BARTER_RP_ID: "barter.example",
        BARTER_ORIGIN: "https://barter.example",
      }),
    ).toMatchObject({ rpID: "barter.example", origins: "https://barter.example" });
  });
});
