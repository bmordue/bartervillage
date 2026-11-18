import { afterEach, describe, expect, it } from "vitest";

import { DiscordAuth, discordOptionsFromEnv } from "../src/auth/discord.js";
import { DISCORD_STATE_COOKIE } from "../src/auth/discordRoutes.js";
import { buildApiRoutes } from "../src/api.js";
import { Database } from "../src/db/database.js";
import { findCredentialBySubject, loadCredentialSecret } from "../src/db/credentialRepository.js";
import { createInviteCode, hashInviteCode, issueInvite } from "../src/db/inviteRepository.js";
import { loadSession } from "../src/db/sessionRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

const KEY = Buffer.alloc(32, 7);

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FakeProvider {
  fetch: typeof fetch;
  calls: FetchCall[];
}

function providerFetch(subject = "discord-user-1"): FakeProvider {
  const calls: FetchCall[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          scope: "identify",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("users")) {
      return new Response(JSON.stringify({ id: subject, username: "ada" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

let db: Database | undefined;
let harness: TestApi | undefined;
let currentTime = new Date("2026-01-01T00:00:00.000Z");

afterEach(async () => {
  db?.close();
  db = undefined;
  await harness?.close();
  harness = undefined;
  currentTime = new Date("2026-01-01T00:00:00.000Z");
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

function auth(
  provider = providerFetch(),
  overrides: Partial<ConstructorParameters<typeof DiscordAuth>[0]> = {},
): DiscordAuth {
  return new DiscordAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://barter.example/auth/discord/callback",
    credentialKey: KEY,
    now: () => currentTime,
    fetch: provider.fetch,
    ...overrides,
  });
}

describe("Discord OAuth start", () => {
  it("builds an authorization-code redirect with PKCE and an onboarding state", () => {
    const { database, inviteCode, plotId } = setup();
    const discord = auth();

    const result = discord.startLogin(database, { inviteCode, name: "Ada", plotId });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe("https://discord.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://barter.example/auth/discord/callback",
    );
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("state")).toBe(result.stateId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = database.get<{
      purpose: string;
      payload_json: string;
      code_verifier: string;
    }>(
      "SELECT purpose, payload_json, code_verifier FROM oauth_states WHERE id = ?",
      result.stateId,
    );
    expect(row?.purpose).toBe("onboard");
    expect(row?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(row?.payload_json ?? "{}")).toMatchObject({
      name: "Ada",
      plotId,
      inviteCodeHash: hashInviteCode(inviteCode),
    });
  });

  it("rejects partial onboarding details and invalid invites before redirecting", () => {
    const { database, inviteCode } = setup();
    const discord = auth();

    expect(discord.startLogin(database, { inviteCode })).toEqual({
      ok: false,
      reason: "invalid_request",
    });
    expect(
      discord.startLogin(database, {
        inviteCode: "wrong",
        name: "Ada",
        plotId: "plot-1",
      }),
    ).toEqual({ ok: false, reason: "invite_invalid" });
    expect(
      discord.startLogin(database, {
        inviteCode,
        name: "Ada",
        plotId: "missing",
      }),
    ).toEqual({ ok: false, reason: "site_unavailable" });
  });
});

describe("Discord OAuth callback", () => {
  it("onboards a new player and stores only encrypted tokens", async () => {
    const { database, inviteCode, plotId } = setup();
    const provider = providerFetch();
    const discord = auth(provider);

    const started = discord.startLogin(database, { inviteCode, name: "Ada", plotId });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    const finished = await discord.finishLogin(database, started.stateId, "auth-code");
    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    expect(
      database.get<{ name: string; plot_id: string }>(
        "SELECT name, plot_id FROM players WHERE id = ?",
        finished.playerId,
      ),
    ).toEqual({ name: "Ada", plot_id: plotId });
    expect(
      database.get<{ redeemed_by_player_id: string | null }>(
        "SELECT redeemed_by_player_id FROM invites WHERE id = 'invite-1'",
      )?.redeemed_by_player_id,
    ).toBe(finished.playerId);

    const credential = findCredentialBySubject(database, "discord", "discord-user-1");
    expect(credential?.playerId).toBe(finished.playerId);
    expect(credential?.secretCiphertext).not.toBeNull();
    expect(credential?.secretCiphertext).not.toContain("access-token");
    const secret = loadCredentialSecret(database, credential?.id ?? "", KEY);
    expect(JSON.parse(secret ?? "{}")).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
    });

    expect(
      loadSession(database, finished.session.id, new Date("2026-01-02T00:00:00.000Z"))?.playerId,
    ).toBe(finished.playerId);
    expect(
      database.get<{ id: string }>("SELECT id FROM oauth_states WHERE id = ?", started.stateId),
    ).toBeUndefined();

    const tokenCall = provider.calls.find((call) => call.url.includes("token"));
    expect(tokenCall?.init?.method).toBe("POST");
    const body = tokenCall?.init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenCall?.init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });

    const userCall = provider.calls.find((call) => call.url.includes("users"));
    expect(userCall?.init?.headers).toMatchObject({ authorization: "Bearer access-token" });
  });

  it("logs in an existing credential and refreshes its token", async () => {
    const { database, inviteCode, plotId } = setup();
    const discord = auth();

    const registered = discord.startLogin(database, { inviteCode, name: "Ada", plotId });
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      return;
    }
    const onboarded = await discord.finishLogin(database, registered.stateId, "first-code");
    expect(onboarded.ok).toBe(true);
    if (!onboarded.ok) {
      return;
    }
    const storedBefore = findCredentialBySubject(database, "discord", "discord-user-1");

    const login = discord.startLogin(database);
    expect(login.ok).toBe(true);
    if (!login.ok) {
      return;
    }
    const loggedIn = await discord.finishLogin(database, login.stateId, "second-code");
    expect(loggedIn.ok).toBe(true);
    if (!loggedIn.ok) {
      return;
    }

    expect(loggedIn.playerId).toBe(onboarded.playerId);
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(1);
    const storedAfter = findCredentialBySubject(database, "discord", "discord-user-1");
    expect(storedAfter?.id).toBe(storedBefore?.id);
    expect(storedAfter?.secretCiphertext).not.toBe(storedBefore?.secretCiphertext);
    expect(loadCredentialSecret(database, storedAfter?.id ?? "", KEY)).toContain("access-token");
  });

  it("refuses a Discord identity that is not linked to a player", async () => {
    const { database } = setup();
    const discord = auth();

    const started = discord.startLogin(database);
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(await discord.finishLogin(database, started.stateId, "auth-code")).toEqual({
      ok: false,
      reason: "account_not_found",
    });
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(0);
  });

  it("consumes the state once and rejects expired states", async () => {
    const { database, inviteCode, plotId } = setup();
    const discord = auth();

    const started = discord.startLogin(database, { inviteCode, name: "Ada", plotId });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await discord.finishLogin(database, started.stateId, "auth-code");
    expect(await discord.finishLogin(database, started.stateId, "auth-code")).toEqual({
      ok: false,
      reason: "state_invalid",
    });

    const expiring = auth(providerFetch(), { stateTtlMs: 1000 });
    const another = expiring.startLogin(database);
    expect(another.ok).toBe(true);
    if (!another.ok) {
      return;
    }
    currentTime = new Date("2026-01-01T00:00:02.000Z");
    expect(await expiring.finishLogin(database, another.stateId, "auth-code")).toEqual({
      ok: false,
      reason: "state_invalid",
    });
  });

  it("reports provider failures without creating a player", async () => {
    const { database, inviteCode, plotId } = setup();
    const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const discord = auth(providerFetch(), { fetch: failing });

    const started = discord.startLogin(database, { inviteCode, name: "Ada", plotId });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(await discord.finishLogin(database, started.stateId, "auth-code")).toEqual({
      ok: false,
      reason: "provider_error",
    });
    expect(database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players")?.count).toBe(0);
  });
});

describe("Discord OAuth REST routes", () => {
  it("redirects to Discord and completes the callback with session cookies", async () => {
    const discord = auth();
    harness = await startTestApi({
      buildRoutes: (testDatabase) => buildApiRoutes(testDatabase, { discord }),
    });
    const { inviteCode, plotId } = seed(harness.database);

    const query = new URLSearchParams({ inviteCode, name: "Ada", plotId });
    const loginResponse = await fetch(`${harness.baseUrl}/auth/discord/login?${query}`, {
      redirect: "manual",
    });
    expect(loginResponse.status).toBe(302);
    const location = loginResponse.headers.get("location") ?? "";
    expect(location).toContain("https://discord.com/oauth2/authorize");
    const stateId = new URL(location).searchParams.get("state") ?? "";

    const stateCookie = loginResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${DISCORD_STATE_COOKIE}=`));
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");

    const callback = await fetch(
      `${harness.baseUrl}/auth/discord/callback?code=auth-code&state=${stateId}`,
      {
        redirect: "manual",
        headers: { cookie: `${DISCORD_STATE_COOKIE}=${stateId}` },
      },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    const cookies = callback.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("bv_session="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("bv_csrf="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith(`${DISCORD_STATE_COOKIE}=;`))).toBe(true);

    expect(harness.database.get<{ name: string }>("SELECT name FROM players")?.name).toBe("Ada");
  });

  it("rejects a callback without the browser-bound state cookie", async () => {
    const discord = auth();
    harness = await startTestApi({
      buildRoutes: (testDatabase) => buildApiRoutes(testDatabase, { discord }),
    });
    const { inviteCode, plotId } = seed(harness.database);

    const query = new URLSearchParams({ inviteCode, name: "Ada", plotId });
    const loginResponse = await fetch(`${harness.baseUrl}/auth/discord/login?${query}`, {
      redirect: "manual",
    });
    const stateId =
      new URL(loginResponse.headers.get("location") ?? "https://x").searchParams.get("state") ?? "";

    const callback = await fetch(
      `${harness.baseUrl}/auth/discord/callback?code=auth-code&state=${stateId}`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(400);
    expect(await callback.json()).toEqual({ error: "state_invalid" });
  });
});

describe("Discord environment", () => {
  const encodedKey = Buffer.alloc(32, 2).toString("base64url");

  it("disables Discord login when no credentials are configured", () => {
    expect(discordOptionsFromEnv({})).toBeUndefined();
  });

  it("requires both halves of the client credentials", () => {
    expect(() => discordOptionsFromEnv({ BARTER_DISCORD_CLIENT_ID: "id" })).toThrow(/together/);
  });

  it("builds options from environment values", () => {
    expect(
      discordOptionsFromEnv({
        BARTER_DISCORD_CLIENT_ID: "id",
        BARTER_DISCORD_CLIENT_SECRET: "secret",
        BARTER_ORIGIN: "https://barter.example",
        BARTER_CREDENTIAL_KEY: encodedKey,
      }),
    ).toMatchObject({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://barter.example/auth/discord/callback",
      successRedirect: "/",
    });
  });

  it("requires HTTPS callback URLs in production", () => {
    expect(() =>
      discordOptionsFromEnv({
        NODE_ENV: "production",
        BARTER_DISCORD_CLIENT_ID: "id",
        BARTER_DISCORD_CLIENT_SECRET: "secret",
        BARTER_DISCORD_REDIRECT_URI: "http://barter.example/auth/discord/callback",
        BARTER_CREDENTIAL_KEY: encodedKey,
      }),
    ).toThrow(/HTTPS/);
  });
});
