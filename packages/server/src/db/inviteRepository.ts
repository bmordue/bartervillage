/**
 * Invite issuance and redemption (spec §3, §12; M4.C05).
 *
 * Only the hash of an invite code is stored. Redemption is a single conditional
 * UPDATE, so two simultaneous redemptions cannot both succeed.
 */

import { createHash, randomBytes } from "node:crypto";

import type { Database } from "./database.js";

export const INVITE_CODE_BYTES = 24;

export interface Invite {
  id: string;
  codeHash: string;
  createdByPlayerId: string | null;
  redeemedByPlayerId: string | null;
  createdAt: string;
  redeemedAt: string | null;
}

export interface IssueInviteOptions {
  id: string;
  codeHash: string;
  createdByPlayerId?: string | null;
  now?: Date;
}

type InviteRow = {
  id: string;
  code_hash: string;
  created_by_player_id: string | null;
  redeemed_by_player_id: string | null;
  created_at: string;
  redeemed_at: string | null;
};

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    codeHash: row.code_hash,
    createdByPlayerId: row.created_by_player_id,
    redeemedByPlayerId: row.redeemed_by_player_id,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at,
  };
}

export function createInviteCode(): string {
  return randomBytes(INVITE_CODE_BYTES).toString("base64url");
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function issueInvite(db: Database, options: IssueInviteOptions): Invite {
  const invite: Invite = {
    id: options.id,
    codeHash: options.codeHash,
    createdByPlayerId: options.createdByPlayerId ?? null,
    redeemedByPlayerId: null,
    createdAt: (options.now ?? new Date()).toISOString(),
    redeemedAt: null,
  };
  db.run(
    `INSERT INTO invites
       (id, code_hash, created_by_player_id, redeemed_by_player_id, created_at, redeemed_at)
     VALUES (?, ?, ?, NULL, ?, NULL)`,
    invite.id,
    invite.codeHash,
    invite.createdByPlayerId,
    invite.createdAt,
  );
  return invite;
}

export function findInviteByCodeHash(db: Database, codeHash: string): Invite | undefined {
  const row = db.get<InviteRow>("SELECT * FROM invites WHERE code_hash = ?", codeHash);
  return row ? toInvite(row) : undefined;
}

/** Returns true only for the first redemption of an unredeemed code. */
export function redeemInvite(
  db: Database,
  codeHash: string,
  playerId: string,
  now: Date = new Date(),
): boolean {
  const result = db.run(
    `UPDATE invites
     SET redeemed_by_player_id = ?, redeemed_at = ?
     WHERE code_hash = ? AND redeemed_by_player_id IS NULL`,
    playerId,
    now.toISOString(),
    codeHash,
  );
  return Number(result.changes) === 1;
}

export function listInvites(db: Database): Invite[] {
  const rows = db.all<InviteRow>("SELECT * FROM invites ORDER BY created_at, id");
  return rows.map(toInvite);
}
