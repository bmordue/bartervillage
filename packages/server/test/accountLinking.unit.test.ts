import { afterEach, describe, expect, it } from "vitest";
import type { RegistrationResponseJSON, verifyRegistrationResponse } from "@simplewebauthn/server";

import { DiscordAuth } from "../src/auth/discord.js";
import { GithubAuth } from "../src/auth/github.js";
import { PasskeyAuth } from "../src/auth/passkey.js";
import { WEBAUTHN_COOKIE } from "../src/auth/passkeyRoutes.js";
import { buildApiRoutes } from "../src/api.js";
import { SESSION_COOKIE } from "../src/cookies.js";
import { Database } from "../src/db/database.js";
import {
  createCredential,
  findCredentialBySubject,
  listPlayerCredentials,
} from "../src/db/credentialRepository.js";
import { createSession } from "../src/db/sessionRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

const KEY = Buffer.alloc(32, 7);

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

interface FakeProvider {
  fetch: typeof fetch;
}

function providerFetch(apiBase: string, subject: number): FakeProvider {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "bearer",
          scope: "read:user",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes(apiBase)) {
      return new Response(JSON.stringify({ id: subject, login: "ada" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchImpl as typeof fetch };
}

let db: Database | undefined;
let harness: TestApi | undefined;

afterEach(async () => {
  db?.close();
  db = undefined;
  await harness?.close();
  harness = undefined;
});

function createWorld(database: Database): void {
  insertWorld(database);
  database.run("INSERT INTO regions (id, x, y, width, height) VALUES ('r1', 0, 0, 12, 12)");
}

function createPlayer(database: Database, id: string, name: string): void {
  database.run(
    `INSERT INTO plots (id, player_id, region_id, site_x, site_y, width, height)
     VALUES (?, NULL, 'r1', ?, ?, 12, 12)`,
    `${id}-plot`,
    id === "p1" ? 0 : 12,
    id === "p1" ? 0 : 0,
  );
  database.run(
    `INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES (?, ?, ?, 0, 100)`,
    id,
    name,
    `${id}-plot`,
  );
  database.run("UPDATE plots SET player_id = ? WHERE id = ?", id, `${id}-plot`);
}

function setup(): Database {
  const database = Database.open();
  db = database;
  createWorld(database);
  createPlayer(database, "p1", "Ada");
  createPlayer(database, "p2", "Grace");
  return database;
}

function session(database: Database, playerId: string): string {
  const id = `session-${playerId}`;
  createSession(database, { id, playerId });
  return id;
}

function discordAuth(): DiscordAuth {
  return new DiscordAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://barter.example/auth/discord/callback",
    credentialKey: KEY,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    fetch: providerFetch("users", 1001).fetch,
  });
}

function githubAuth(): GithubAuth {
  return new GithubAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://barter.example/auth/github/callback",
    credentialKey: KEY,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    fetch: providerFetch("api.github.com/user", 2002).fetch,
  });
}

function passkeyAuth(): PasskeyAuth {
  return new PasskeyAuth({
    rpID: "localhost",
    rpName: "Barter Village",
    origins: "http://localhost:3000",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    verifyRegistration: verifiedRegistration,
  });
}

describe("OAuth account linking", () => {
  it("links a Discord identity to an existing player without creating a player", async () => {
    const database = setup();
    const discord = discordAuth();

    const started = discord.startLogin(database, { linkPlayerId: "p1" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const state = database.get<{ purpose: string; payload_json: string }>(
      "SELECT purpose, payload_json FROM oauth_states WHERE id = ?",
      started.stateId,
    );
    expect(state?.purpose).toBe("link");
    expect(JSON.parse(state?.payload_json ?? "{}")).toEqual({ playerId: "p1" });

    const finished = await discord.finishLogin(database, started.stateId, "auth-code");
    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }
    expect(finished.playerId).toBe("p1");
    expect(findCredentialBySubject(database, "discord", "1001")?.playerId).toBe("p1");
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(2);
  });

  it("links a GitHub identity to an existing player", async () => {
    const database = setup();
    const github = githubAuth();

    const started = github.startLogin(database, { linkPlayerId: "p2" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const finished = await github.finishLogin(database, started.stateId, "auth-code");
    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    expect(finished.playerId).toBe("p2");
    expect(findCredentialBySubject(database, "github", "2002")?.playerId).toBe("p2");
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(2);
  });

  it("refuses a credential already linked to another player", async () => {
    const database = setup();
    createCredential(
      database,
      {
        id: "cred-discord-p2",
        playerId: "p2",
        kind: "discord",
        subject: "1001",
        secret: "old-token-set",
      },
      KEY,
    );
    const discord = discordAuth();

    const started = discord.startLogin(database, { linkPlayerId: "p1" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(await discord.finishLogin(database, started.stateId, "auth-code")).toEqual({
      ok: false,
      reason: "credential_taken",
    });
    expect(findCredentialBySubject(database, "discord", "1001")?.playerId).toBe("p2");
    expect(listPlayerCredentials(database, "p1")).toHaveLength(0);
  });

  it("rejects an unknown player and mixing linking with onboarding", () => {
    const database = setup();
    const discord = discordAuth();

    expect(discord.startLogin(database, { linkPlayerId: "ghost" })).toEqual({
      ok: false,
      reason: "account_not_found",
    });
    expect(
      discord.startLogin(database, {
        linkPlayerId: "p1",
        inviteCode: "invite",
        name: "Ada",
        plotId: "p1-plot",
      }),
    ).toEqual({ ok: false, reason: "invalid_request" });
  });
});

describe("OAuth link REST routes", () => {
  it("requires a session and redirects a signed-in player to the provider", async () => {
    const discord = discordAuth();
    harness = await startTestApi({
      buildRoutes: (database) => buildApiRoutes(database, { discord }),
    });
    createWorld(harness.database);
    createPlayer(harness.database, "p1", "Ada");
    const sessionId = session(harness.database, "p1");

    const anonymous = await fetch(`${harness.baseUrl}/auth/discord/link`, { redirect: "manual" });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "not_authenticated" });

    const linked = await fetch(`${harness.baseUrl}/auth/discord/link`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    });
    expect(linked.status).toBe(302);
    expect(linked.headers.get("location")).toContain("https://discord.com/oauth2/authorize");
    expect(linked.headers.getSetCookie().some((cookie) => cookie.startsWith("bv_discord="))).toBe(
      true,
    );
  });

  it("offers the same link entry point for GitHub", async () => {
    const github = githubAuth();
    harness = await startTestApi({
      buildRoutes: (database) => buildApiRoutes(database, { github }),
    });
    createWorld(harness.database);
    createPlayer(harness.database, "p1", "Ada");
    const sessionId = session(harness.database, "p1");

    const linked = await fetch(`${harness.baseUrl}/auth/github/link`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    });
    expect(linked.status).toBe(302);
    expect(linked.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
  });
});

describe("passkey account linking", () => {
  it("adds a passkey to an existing player and rejects one owned by another player", async () => {
    const database = setup();
    const passkey = passkeyAuth();

    const started = await passkey.startLinkRegistration(database, "p1");
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.options.user.name).toBe("Ada");

    const finished = await passkey.finishLinkRegistration(
      database,
      started.challengeId,
      registrationResponse,
    );
    expect(finished).toEqual({ ok: true, playerId: "p1" });
    const credential = findCredentialBySubject(database, "passkey", "credential-id");
    expect(credential?.playerId).toBe("p1");
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(2);

    const relinked = await passkey.startLinkRegistration(database, "p1");
    expect(relinked.ok).toBe(true);
    if (!relinked.ok) {
      return;
    }
    expect(
      await passkey.finishLinkRegistration(database, relinked.challengeId, registrationResponse),
    ).toEqual({ ok: true, playerId: "p1" });

    const otherPlayer = await passkey.startLinkRegistration(database, "p2");
    expect(otherPlayer.ok).toBe(true);
    if (!otherPlayer.ok) {
      return;
    }
    expect(
      await passkey.finishLinkRegistration(database, otherPlayer.challengeId, registrationResponse),
    ).toEqual({ ok: false, reason: "credential_taken" });
    expect(findCredentialBySubject(database, "passkey", "credential-id")?.playerId).toBe("p1");
  });

  it("links over HTTP only when signed in", async () => {
    const passkey = passkeyAuth();
    harness = await startTestApi({
      buildRoutes: (database) => buildApiRoutes(database, { passkey }),
    });
    createWorld(harness.database);
    createPlayer(harness.database, "p1", "Ada");
    const sessionId = session(harness.database, "p1");
    const sessionCookie = `${SESSION_COOKIE}=${sessionId}`;

    const anonymous = await fetch(`${harness.baseUrl}/auth/passkey/link/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(anonymous.status).toBe(401);

    const optionsResponse = await fetch(`${harness.baseUrl}/auth/passkey/link/options`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
    });
    expect(optionsResponse.status).toBe(200);
    const challengeId =
      optionsResponse.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith(`${WEBAUTHN_COOKIE}=`))
        ?.split(";")[0]
        ?.split("=")[1] ?? "";

    const verifyResponse = await fetch(`${harness.baseUrl}/auth/passkey/link/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${sessionCookie}; ${WEBAUTHN_COOKIE}=${challengeId}`,
      },
      body: JSON.stringify({ response: registrationResponse }),
    });
    expect(verifyResponse.status).toBe(200);
    expect(await verifyResponse.json()).toEqual({ ok: true, playerId: "p1" });
    expect(findCredentialBySubject(harness.database, "passkey", "credential-id")?.playerId).toBe(
      "p1",
    );
  });
});

describe("credential management", () => {
  it("lists, unlinks and protects a player's credentials", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => buildApiRoutes(database),
    });
    createWorld(harness.database);
    createPlayer(harness.database, "p1", "Ada");
    createPlayer(harness.database, "p2", "Grace");
    const sessionId = session(harness.database, "p1");

    createCredential(harness.database, {
      id: "cred-passkey",
      playerId: "p1",
      kind: "passkey",
      subject: "passkey-1",
      publicKey: Buffer.from([1, 2]).toString("base64url"),
    });
    createCredential(
      harness.database,
      {
        id: "cred-discord",
        playerId: "p1",
        kind: "discord",
        subject: "discord-1",
        secret: "secret-token",
      },
      KEY,
    );
    createCredential(
      harness.database,
      {
        id: "cred-other",
        playerId: "p2",
        kind: "github",
        subject: "github-1",
        secret: "other-token",
      },
      KEY,
    );

    const sessionCookie = `${SESSION_COOKIE}=${sessionId}`;
    const listResponse = await fetch(`${harness.baseUrl}/auth/credentials`, {
      headers: { cookie: sessionCookie },
    });
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      credentials: { id: string; kind: string; createdAt: string }[];
    };
    expect(listed.credentials.map((credential) => credential.kind).sort()).toEqual([
      "discord",
      "passkey",
    ]);
    expect(JSON.stringify(listed)).not.toContain("secret-token");

    const csrfToken = "csrf-token";
    const mutationCookie = `${sessionCookie}; bv_csrf=${csrfToken}`;
    const unlink = await fetch(`${harness.baseUrl}/auth/credentials/cred-discord`, {
      method: "DELETE",
      headers: { cookie: mutationCookie, "x-csrf-token": csrfToken },
    });
    expect(unlink.status).toBe(200);
    expect(
      listPlayerCredentials(harness.database, "p1").map((credential) => credential.id),
    ).toEqual(["cred-passkey"]);

    const last = await fetch(`${harness.baseUrl}/auth/credentials/cred-passkey`, {
      method: "DELETE",
      headers: { cookie: mutationCookie, "x-csrf-token": csrfToken },
    });
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: "last_credential" });

    const other = await fetch(`${harness.baseUrl}/auth/credentials/cred-other`, {
      method: "DELETE",
      headers: { cookie: mutationCookie, "x-csrf-token": csrfToken },
    });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "credential_not_found" });

    const noCsrf = await fetch(`${harness.baseUrl}/auth/credentials/cred-passkey`, {
      method: "DELETE",
      headers: { cookie: sessionCookie },
    });
    expect(noCsrf.status).toBe(403);
    expect(await noCsrf.json()).toEqual({ error: "csrf_failed" });
  });
});
