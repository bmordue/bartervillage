/**
 * Passkey registration and login (spec §12; M4.C01).
 *
 * WebAuthn challenges are generated and consumed server-side, and only public
 * key material is stored. Private keys stay on the authenticator, so there is
 * no password or shared secret for the server to leak.
 */

import { randomBytes } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";

import {
  findCredentialBySubject,
  listPlayerCredentials,
  updatePasskeyCredential,
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
  consumeWebAuthnChallenge,
  createWebAuthnChallenge,
  type WebAuthnChallengeKind,
} from "../db/webauthnChallengeRepository.js";

export const DEFAULT_RP_NAME = "Barter Village";
export const DEFAULT_RP_ID = "localhost";
export const DEFAULT_ORIGIN = "http://localhost:3000";

export interface PasskeyAuthOptions {
  rpID: string;
  rpName: string;
  origins: string | string[];
  challengeTtlMs?: number;
  now?: () => Date;
  verifyRegistration?: typeof verifyRegistrationResponse;
  verifyAuthentication?: typeof verifyAuthenticationResponse;
}

export type PasskeyError =
  | "invalid_request"
  | "invite_invalid"
  | "player_cap_reached"
  | "name_taken"
  | "site_unavailable"
  | "challenge_invalid"
  | "verification_failed"
  | "no_passkey"
  | "credential_not_found";

export interface StartRegistrationInput {
  inviteCode: string;
  name: string;
  plotId: string;
}

export type StartRegistrationResult =
  | {
      ok: true;
      options: PublicKeyCredentialCreationOptionsJSON;
      challengeId: string;
    }
  | { ok: false; reason: PasskeyError };

export type FinishRegistrationResult =
  | { ok: true; playerId: string; plotId: string; session: Session }
  | { ok: false; reason: PasskeyError };

export interface StartAuthenticationInput {
  playerId?: string;
}

export type StartAuthenticationResult =
  | {
      ok: true;
      options: PublicKeyCredentialRequestOptionsJSON;
      challengeId: string;
    }
  | { ok: false; reason: PasskeyError };

export type FinishAuthenticationResult =
  { ok: true; playerId: string; session: Session } | { ok: false; reason: PasskeyError };

const USER_ID = {
  minLength: 1,
  maxLength: 64,
} as const;

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(24).toString("base64url")}`;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function failureReason(reason: OnboardFailureReason): PasskeyError {
  switch (reason) {
    case "invite_invalid":
      return "invite_invalid";
    case "site_unavailable":
      return "site_unavailable";
    case "player_cap_reached":
      return "player_cap_reached";
  }
}

function toWebAuthnCredential(
  id: string,
  publicKey: string,
  counter: number,
  transports: string[],
): WebAuthnCredential {
  return {
    id,
    publicKey: Buffer.from(publicKey, "base64url"),
    counter,
    ...(transports.length > 0 ? { transports } : {}),
  };
}

export class PasskeyAuth {
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly origins: string | string[];
  private readonly challengeTtlMs: number | undefined;
  private readonly now: () => Date;
  private readonly verifyRegistration: typeof verifyRegistrationResponse;
  private readonly verifyAuthentication: typeof verifyAuthenticationResponse;

  constructor(options: PasskeyAuthOptions) {
    this.rpID = options.rpID;
    this.rpName = options.rpName;
    this.origins = options.origins;
    this.challengeTtlMs = options.challengeTtlMs;
    this.now = options.now ?? (() => new Date());
    this.verifyRegistration = options.verifyRegistration ?? verifyRegistrationResponse;
    this.verifyAuthentication = options.verifyAuthentication ?? verifyAuthenticationResponse;
  }

  private createChallenge(
    db: Database,
    kind: WebAuthnChallengeKind,
    challenge: string,
    payload: Record<string, unknown>,
  ): string {
    const challengeId = randomId("webauthn");
    createWebAuthnChallenge(db, {
      id: challengeId,
      kind,
      challenge,
      payload,
      now: this.now(),
      ...(this.challengeTtlMs === undefined ? {} : { ttlMs: this.challengeTtlMs }),
    });
    return challengeId;
  }

  async startRegistration(
    db: Database,
    input: StartRegistrationInput,
  ): Promise<StartRegistrationResult> {
    const name = input.name.trim();
    const plotId = input.plotId.trim();
    if (name.length === 0 || name.length > 32 || plotId.length === 0) {
      return { ok: false, reason: "invalid_request" };
    }
    if (input.inviteCode.length === 0) {
      return { ok: false, reason: "invite_invalid" };
    }

    const inviteCodeHash = hashInviteCode(input.inviteCode);
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

    const playerId = randomId("player");
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new TextEncoder().encode(playerId),
      userName: name,
      userDisplayName: name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    if (options.user.id.length < USER_ID.minLength || options.user.id.length > USER_ID.maxLength) {
      return { ok: false, reason: "invalid_request" };
    }

    const challengeId = this.createChallenge(db, "registration", options.challenge, {
      playerId,
      name,
      plotId,
      inviteCodeHash,
    });
    return { ok: true, options, challengeId };
  }

  async finishRegistration(
    db: Database,
    challengeId: string,
    response: RegistrationResponseJSON,
  ): Promise<FinishRegistrationResult> {
    const challenge = consumeWebAuthnChallenge(db, challengeId, "registration", this.now());
    if (!challenge) {
      return { ok: false, reason: "challenge_invalid" };
    }

    const playerId = readString(challenge.payload, "playerId");
    const name = readString(challenge.payload, "name");
    const plotId = readString(challenge.payload, "plotId");
    const inviteCodeHash = readString(challenge.payload, "inviteCodeHash");
    if (!playerId || !name || !plotId || !inviteCodeHash) {
      return { ok: false, reason: "challenge_invalid" };
    }

    let registration;
    try {
      registration = await this.verifyRegistration({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch {
      return { ok: false, reason: "verification_failed" };
    }
    if (!registration.verified) {
      return { ok: false, reason: "verification_failed" };
    }

    const credential = registration.registrationInfo.credential;
    const sessionId = randomId("session");
    const result = onboardPlayer(db, {
      playerId,
      name,
      plotId,
      inviteCodeHash,
      sessionId,
      now: this.now(),
      credential: {
        id: randomId("credential"),
        kind: "passkey",
        subject: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: registration.registrationInfo.credentialDeviceType,
        backedUp: registration.registrationInfo.credentialBackedUp,
        now: this.now(),
      },
    });
    if (!result.ok) {
      return { ok: false, reason: failureReason(result.reason) };
    }
    return { ok: true, playerId: result.playerId, plotId: result.plotId, session: result.session };
  }

  async startAuthentication(
    db: Database,
    input: StartAuthenticationInput,
  ): Promise<StartAuthenticationResult> {
    let allowCredentials: { id: string; transports?: string[] }[] | undefined;
    const playerId = input.playerId?.trim();
    if (playerId !== undefined) {
      if (playerId.length === 0) {
        return { ok: false, reason: "invalid_request" };
      }
      const credentials = listPlayerCredentials(db, playerId).filter(
        (credential) => credential.kind === "passkey",
      );
      if (credentials.length === 0) {
        return { ok: false, reason: "no_passkey" };
      }
      allowCredentials = credentials.map((credential) => ({
        id: credential.subject,
        ...(credential.transports.length > 0 ? { transports: credential.transports } : {}),
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required",
      ...(allowCredentials === undefined ? {} : { allowCredentials }),
    });
    const payload: Record<string, unknown> = playerId === undefined ? {} : { playerId };
    const challengeId = this.createChallenge(db, "authentication", options.challenge, payload);
    return { ok: true, options, challengeId };
  }

  async finishAuthentication(
    db: Database,
    challengeId: string,
    response: AuthenticationResponseJSON,
  ): Promise<FinishAuthenticationResult> {
    const challenge = consumeWebAuthnChallenge(db, challengeId, "authentication", this.now());
    if (!challenge) {
      return { ok: false, reason: "challenge_invalid" };
    }

    const expectedPlayerId = readString(challenge.payload, "playerId");
    const credential = findCredentialBySubject(db, "passkey", response.id);
    if (
      !credential ||
      credential.publicKey === null ||
      (expectedPlayerId !== undefined && credential.playerId !== expectedPlayerId)
    ) {
      return { ok: false, reason: "credential_not_found" };
    }

    let authentication;
    try {
      authentication = await this.verifyAuthentication({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        credential: toWebAuthnCredential(
          credential.subject,
          credential.publicKey,
          credential.counter,
          credential.transports,
        ),
        requireUserVerification: true,
      });
    } catch {
      return { ok: false, reason: "verification_failed" };
    }
    if (!authentication.verified) {
      return { ok: false, reason: "verification_failed" };
    }

    updatePasskeyCredential(db, credential.id, {
      counter: authentication.authenticationInfo.newCounter,
      deviceType: authentication.authenticationInfo.credentialDeviceType,
      backedUp: authentication.authenticationInfo.credentialBackedUp,
    });

    const session = createSession(db, {
      id: randomId("session"),
      playerId: credential.playerId,
      now: this.now(),
    });
    return { ok: true, playerId: credential.playerId, session };
  }
}

export function passkeyOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PasskeyAuthOptions {
  const rpID = env.BARTER_RP_ID ?? DEFAULT_RP_ID;
  const originSetting = env.BARTER_ORIGIN ?? DEFAULT_ORIGIN;
  const origins = originSetting
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) {
    throw new Error("BARTER_ORIGIN must contain at least one origin");
  }
  if (env.NODE_ENV === "production" && origins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("WebAuthn requires HTTPS origins in production");
  }
  return {
    rpID,
    rpName: env.BARTER_RP_NAME ?? DEFAULT_RP_NAME,
    origins: origins.length === 1 ? origins[0]! : origins,
  };
}
