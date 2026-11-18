/**
 * Transactional onboarding (spec §5; M4.C08).
 *
 * Creating the player, claiming the site, redeeming the invite, provisioning
 * starter buildings and creating the session all happen in one transaction. A
 * site claimed by someone else wins (first write wins) and rolls this attempt
 * back completely.
 */

import { createCredential, type CreateCredentialOptions } from "./credentialRepository.js";
import type { Database } from "./database.js";
import { redeemInvite } from "./inviteRepository.js";
import { claimPlot } from "./mapRepository.js";
import { provisionStarterBuildings } from "./playerRepository.js";
import { createSession, type Session } from "./sessionRepository.js";

export const STARTING_ENERGY = 100;
export const MAX_PLAYERS = 20;

export type OnboardFailureReason = "invite_invalid" | "site_unavailable" | "player_cap_reached";

export type OnboardResult =
  | { ok: true; playerId: string; plotId: string; session: Session }
  | { ok: false; reason: OnboardFailureReason };

export interface OnboardPlayerOptions {
  playerId: string;
  name: string;
  plotId: string;
  inviteCodeHash: string;
  sessionId: string;
  credential?: Omit<CreateCredentialOptions, "playerId">;
  credentialKey?: Buffer;
  now?: Date;
  sessionTtlMs?: number;
}

class OnboardFailure extends Error {
  constructor(readonly reason: OnboardFailureReason) {
    super(reason);
    this.name = "OnboardFailure";
  }
}

export function onboardPlayer(db: Database, options: OnboardPlayerOptions): OnboardResult {
  try {
    return db.transaction(() => {
      const now = options.now ?? new Date();
      const world = db.get<{ player_cap: number }>("SELECT player_cap FROM worlds LIMIT 1");
      const playerCap = Math.min(world?.player_cap ?? MAX_PLAYERS, MAX_PLAYERS);
      const { count } = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM players") ?? {
        count: 0,
      };
      if (count >= playerCap) {
        throw new OnboardFailure("player_cap_reached");
      }
      db.run(
        `INSERT INTO players (id, name, plot_id, joined_tick, energy)
         VALUES (?, ?, ?, 0, ?)`,
        options.playerId,
        options.name,
        options.plotId,
        STARTING_ENERGY,
      );

      if (!claimPlot(db, options.playerId, options.plotId)) {
        throw new OnboardFailure("site_unavailable");
      }

      if (!redeemInvite(db, options.inviteCodeHash, options.playerId, now)) {
        throw new OnboardFailure("invite_invalid");
      }

      provisionStarterBuildings(db, options.plotId);
      if (options.credential !== undefined) {
        createCredential(
          db,
          { ...options.credential, playerId: options.playerId, now },
          options.credentialKey,
        );
      }
      const session = createSession(db, {
        id: options.sessionId,
        playerId: options.playerId,
        now,
        ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }),
      });

      return { ok: true as const, playerId: options.playerId, plotId: options.plotId, session };
    });
  } catch (error) {
    if (error instanceof OnboardFailure) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}
