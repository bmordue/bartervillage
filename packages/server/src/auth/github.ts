/**
 * GitHub OAuth login (spec §12; M4.C03).
 *
 * The authorization-code flow uses PKCE, a single-use server-side state and an
 * HttpOnly cookie binding. OAuth tokens are encrypted before storage and are
 * never exposed to the client. New players can only be created through the
 * existing invite-only onboarding path.
 */

import { createHash, randomBytes } from "node:crypto";

import { loadCredentialKey } from "../crypto.js";
import {
  createCredential,
  findCredentialBySubject,
  updateCredentialSecret,
} from "../db/credentialRepository.js";
import type { Database } from "../db/database.js";
import { hashInviteCode } from "../db/inviteRepository.js";
import {
  MAX_PLAYERS,
  onboardPlayer,
  type OnboardFailureReason,
} from "../db/onboardingRepository.js";
import { createSession, type Session } from "../db/sessionRepository.js";
import {
  consumeOAuthState,
  createOAuthState,
  purgeExpiredOAuthStates,
} from "../db/oauthStateRepository.js";

export const DEFAULT_GITHUB_AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
export const DEFAULT_GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
export const DEFAULT_GITHUB_USER_ENDPOINT = "https://api.github.com/user";
export const DEFAULT_GITHUB_ORIGIN = "http://localhost:3000";
export const DEFAULT_GITHUB_SUCCESS_REDIRECT = "/";

export type GithubError =
  | "invalid_request"
  | "invite_invalid"
  | "player_cap_reached"
  | "name_taken"
  | "site_unavailable"
  | "state_invalid"
  | "provider_error"
  | "account_not_found"
  | "credential_taken";

export interface GithubAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  credentialKey: Buffer;
  authorizeEndpoint?: string;
  tokenEndpoint?: string;
  userEndpoint?: string;
  successRedirect?: string;
  stateTtlMs?: number;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}

export interface StartGithubLoginInput {
  inviteCode?: string;
  name?: string;
  plotId?: string;
  /** Attach the GitHub identity to this existing player instead of signing in. */
  linkPlayerId?: string;
}

export type StartGithubLoginResult =
  { ok: true; authorizationUrl: string; stateId: string } | { ok: false; reason: GithubError };

export type FinishGithubLoginResult =
  | { ok: true; playerId: string; session: Session; stateId: string }
  | { ok: false; reason: GithubError };

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(24).toString("base64url")}`;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureReason(reason: OnboardFailureReason): GithubError {
  switch (reason) {
    case "invite_invalid":
      return "invite_invalid";
    case "site_unavailable":
      return "site_unavailable";
    case "player_cap_reached":
      return "player_cap_reached";
  }
}

interface GithubTokenSet {
  accessToken: string;
  tokenType: string;
  scope: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
}

function readTokenSet(payload: Record<string, unknown>): GithubTokenSet | undefined {
  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return undefined;
  }
  return {
    accessToken,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: typeof payload.scope === "string" ? payload.scope : null,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
        ? payload.refresh_token
        : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
  };
}

function serializeTokenSet(tokenSet: GithubTokenSet): string {
  return JSON.stringify(tokenSet);
}

export class GithubAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly credentialKey: Buffer;
  private readonly authorizeEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly userEndpoint: string;
  private readonly stateTtlMs: number | undefined;
  private readonly now: () => Date;
  private readonly fetch: typeof globalThis.fetch;
  readonly successRedirect: string;

  constructor(options: GithubAuthOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.credentialKey = options.credentialKey;
    this.authorizeEndpoint = options.authorizeEndpoint ?? DEFAULT_GITHUB_AUTHORIZE_ENDPOINT;
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_GITHUB_TOKEN_ENDPOINT;
    this.userEndpoint = options.userEndpoint ?? DEFAULT_GITHUB_USER_ENDPOINT;
    this.stateTtlMs = options.stateTtlMs;
    this.now = options.now ?? (() => new Date());
    this.fetch = options.fetch ?? globalThis.fetch;
    this.successRedirect = options.successRedirect ?? DEFAULT_GITHUB_SUCCESS_REDIRECT;
  }

  startLogin(db: Database, input: StartGithubLoginInput = {}): StartGithubLoginResult {
    purgeExpiredOAuthStates(db, this.now());

    const provided = [input.inviteCode, input.name, input.plotId].filter(
      (value) => value !== undefined,
    );
    const onboarding = provided.length > 0;
    if (onboarding && provided.length !== 3) {
      return { ok: false, reason: "invalid_request" };
    }
    const linking = input.linkPlayerId !== undefined;
    if (linking && onboarding) {
      return { ok: false, reason: "invalid_request" };
    }

    let payload: Record<string, unknown> = {};
    if (linking) {
      const linkPlayerId = input.linkPlayerId?.trim() ?? "";
      if (linkPlayerId.length === 0) {
        return { ok: false, reason: "invalid_request" };
      }
      if (!db.get<{ id: string }>("SELECT id FROM players WHERE id = ?", linkPlayerId)) {
        return { ok: false, reason: "account_not_found" };
      }
      payload = { playerId: linkPlayerId };
    } else if (onboarding) {
      const inviteCode = input.inviteCode?.trim() ?? "";
      const name = input.name?.trim() ?? "";
      const plotId = input.plotId?.trim() ?? "";
      if (inviteCode.length === 0 || name.length === 0 || plotId.length === 0) {
        return { ok: false, reason: "invalid_request" };
      }
      if (name.length > 32) {
        return { ok: false, reason: "invalid_request" };
      }

      const inviteCodeHash = hashInviteCode(inviteCode);
      const invite = db.get<{ redeemed_by_player_id: string | null }>(
        "SELECT redeemed_by_player_id FROM invites WHERE code_hash = ?",
        inviteCodeHash,
      );
      if (!invite || invite.redeemed_by_player_id !== null) {
        return { ok: false, reason: "invite_invalid" };
      }

      const world = db.get<{ player_cap: number }>("SELECT player_cap FROM worlds LIMIT 1");
      const playerCap = Math.min(world?.player_cap ?? MAX_PLAYERS, MAX_PLAYERS);
      const { count } = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM players") ?? {
        count: 0,
      };
      if (count >= playerCap) {
        return { ok: false, reason: "player_cap_reached" };
      }
      if (db.get<{ id: string }>("SELECT id FROM players WHERE name = ?", name)) {
        return { ok: false, reason: "name_taken" };
      }
      const plot = db.get<{ id: string }>(
        "SELECT id FROM plots WHERE id = ? AND player_id IS NULL AND world_owned = 0",
        plotId,
      );
      if (!plot) {
        return { ok: false, reason: "site_unavailable" };
      }

      payload = { name, plotId, inviteCodeHash };
    }

    const stateId = randomId("oauth");
    const codeVerifier = randomBytes(32).toString("base64url");
    createOAuthState(db, {
      id: stateId,
      provider: "github",
      purpose: onboarding ? "onboard" : linking ? "link" : "login",
      payload,
      codeVerifier,
      now: this.now(),
      ...(this.stateTtlMs === undefined ? {} : { ttlMs: this.stateTtlMs }),
    });

    const authorizationUrl = new URL(this.authorizeEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", this.clientId);
    authorizationUrl.searchParams.set("redirect_uri", this.redirectUri);
    authorizationUrl.searchParams.set("scope", "read:user");
    authorizationUrl.searchParams.set("state", stateId);
    authorizationUrl.searchParams.set("code_challenge", this.pkceChallenge(codeVerifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return { ok: true, authorizationUrl: authorizationUrl.toString(), stateId };
  }

  async finishLogin(db: Database, stateId: string, code: string): Promise<FinishGithubLoginResult> {
    if (stateId.length === 0 || code.length === 0) {
      return { ok: false, reason: "invalid_request" };
    }
    const state = consumeOAuthState(db, stateId, "github", this.now());
    if (!state) {
      return { ok: false, reason: "state_invalid" };
    }

    const tokenSet = await this.exchangeCode(state.codeVerifier, code);
    if (!tokenSet) {
      return { ok: false, reason: "provider_error" };
    }
    const subject = await this.fetchSubject(tokenSet.accessToken);
    if (!subject) {
      return { ok: false, reason: "provider_error" };
    }

    const secret = serializeTokenSet(tokenSet);
    const linkPlayerId = readString(state.payload, "playerId");
    const existing = findCredentialBySubject(db, "github", subject);
    if (existing) {
      if (state.purpose === "link" && existing.playerId !== linkPlayerId) {
        return { ok: false, reason: "credential_taken" };
      }
      updateCredentialSecret(db, existing.id, secret, this.credentialKey);
      const session = createSession(db, {
        id: randomId("session"),
        playerId: existing.playerId,
        now: this.now(),
      });
      return { ok: true, playerId: existing.playerId, session, stateId };
    }

    if (state.purpose === "link") {
      if (!linkPlayerId) {
        return { ok: false, reason: "state_invalid" };
      }
      if (!db.get<{ id: string }>("SELECT id FROM players WHERE id = ?", linkPlayerId)) {
        return { ok: false, reason: "account_not_found" };
      }
      createCredential(
        db,
        {
          id: randomId("credential"),
          playerId: linkPlayerId,
          kind: "github",
          subject,
          secret,
          now: this.now(),
        },
        this.credentialKey,
      );
      const session = createSession(db, {
        id: randomId("session"),
        playerId: linkPlayerId,
        now: this.now(),
      });
      return { ok: true, playerId: linkPlayerId, session, stateId };
    }

    if (state.purpose !== "onboard") {
      return { ok: false, reason: "account_not_found" };
    }

    const name = readString(state.payload, "name");
    const plotId = readString(state.payload, "plotId");
    const inviteCodeHash = readString(state.payload, "inviteCodeHash");
    if (!name || !plotId || !inviteCodeHash) {
      return { ok: false, reason: "state_invalid" };
    }

    const result = onboardPlayer(db, {
      playerId: randomId("player"),
      name,
      plotId,
      inviteCodeHash,
      sessionId: randomId("session"),
      credentialKey: this.credentialKey,
      now: this.now(),
      credential: {
        id: randomId("credential"),
        kind: "github",
        subject,
        secret,
        now: this.now(),
      },
    });
    if (!result.ok) {
      return { ok: false, reason: failureReason(result.reason) };
    }
    return {
      ok: true,
      playerId: result.playerId,
      session: result.session,
      stateId,
    };
  }

  private pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  private async exchangeCode(
    codeVerifier: string,
    code: string,
  ): Promise<GithubTokenSet | undefined> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: codeVerifier,
    });

    let response: Response;
    try {
      response = await this.fetch(this.tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
    } catch {
      return undefined;
    }
    if (!response.ok) {
      return undefined;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return undefined;
    }
    return isRecord(payload) ? readTokenSet(payload) : undefined;
  }

  private async fetchSubject(accessToken: string): Promise<string | undefined> {
    let response: Response;
    try {
      response = await this.fetch(this.userEndpoint, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });
    } catch {
      return undefined;
    }
    if (!response.ok) {
      return undefined;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return undefined;
    }
    if (!isRecord(payload)) {
      return undefined;
    }
    const id = payload.id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
    return typeof id === "number" ? String(id) : undefined;
  }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Build GitHub options from the environment. Returns undefined when GitHub
 * login is not configured, so local development does not need credentials.
 */
export function githubOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GithubAuthOptions | undefined {
  const clientId = envValue(env, "BARTER_GITHUB_CLIENT_ID");
  const clientSecret = envValue(env, "BARTER_GITHUB_CLIENT_SECRET");
  if (clientId === undefined && clientSecret === undefined) {
    return undefined;
  }
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error("BARTER_GITHUB_CLIENT_ID and BARTER_GITHUB_CLIENT_SECRET must be set together");
  }

  const origin = envValue(env, "BARTER_ORIGIN")?.split(",")[0]?.trim() ?? DEFAULT_GITHUB_ORIGIN;
  const redirectUri =
    envValue(env, "BARTER_GITHUB_REDIRECT_URI") ?? `${origin}/auth/github/callback`;
  const successRedirect = envValue(env, "BARTER_GITHUB_SUCCESS_REDIRECT") ?? "/";

  if (env.NODE_ENV === "production" && !redirectUri.startsWith("https://")) {
    throw new Error("GitHub OAuth requires an HTTPS redirect URI in production");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    credentialKey: loadCredentialKey(env),
    successRedirect,
  };
}
