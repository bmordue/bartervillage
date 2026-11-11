/**
 * Append-only tick log, archived events and avatar paths (spec §10, §12, §14.8;
 * M3.18).
 *
 * A tick's state hash and events are written together and never rewritten:
 * both tables are keyed by `(world_id, tick)` / `(world_id, tick, sequence)`, so
 * a second append for the same tick fails instead of overwriting history.
 */

import type { AvatarPath, GameEvent, TickHeader } from "@bartervillage/rules";
import type { Database } from "./database.js";

export interface TickLogRecord {
  worldId: string;
  tick: number;
  header: TickHeader;
  stateHash: string;
  events: readonly GameEvent[];
  avatarPaths?: readonly AvatarPath[];
}

export interface StoredTickLog {
  tick: number;
  header: TickHeader;
  stateHash: string;
  events: GameEvent[];
  avatarPaths: AvatarPath[];
}

type TickLogRow = {
  tick: number;
  header_json: string;
  state_hash: string;
};

type EventRow = {
  tick: number;
  sequence: number;
  version: number;
  type: GameEvent["type"];
  payload_json: string;
};

type AvatarPathRow = {
  player_id: string;
  path_json: string;
  returned_home: number;
};

/**
 * Append one resolved tick. Runs in a single transaction so a failure leaves no
 * partial replay behind. A duplicate tick throws and rolls back.
 */
export function appendTickLog(db: Database, record: TickLogRecord): void {
  db.transaction(() => {
    db.run(
      "INSERT INTO tick_logs (world_id, tick, header_json, state_hash) VALUES (?, ?, ?, ?)",
      record.worldId,
      record.tick,
      JSON.stringify(record.header),
      record.stateHash,
    );

    for (const event of record.events) {
      db.run(
        "INSERT INTO archived_events (world_id, tick, sequence, version, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        record.worldId,
        event.tick,
        event.sequence,
        event.version,
        event.type,
        JSON.stringify(event.payload),
      );
    }

    for (const path of record.avatarPaths ?? []) {
      db.run(
        "INSERT INTO avatar_paths (world_id, tick, player_id, path_json, returned_home) VALUES (?, ?, ?, ?, ?)",
        record.worldId,
        path.tick,
        path.playerId,
        JSON.stringify(path),
        path.returnedHome ? 1 : 0,
      );
    }
  });
}

export function loadTickLog(
  db: Database,
  worldId: string,
  tick: number,
): StoredTickLog | undefined {
  const row = db.get<TickLogRow>(
    "SELECT tick, header_json, state_hash FROM tick_logs WHERE world_id = ? AND tick = ?",
    worldId,
    tick,
  );
  if (!row) {
    return undefined;
  }
  return {
    tick: row.tick,
    header: JSON.parse(row.header_json) as TickHeader,
    stateHash: row.state_hash,
    events: loadArchivedEvents(db, worldId, tick),
    avatarPaths: loadAvatarPaths(db, worldId, tick),
  };
}

export function loadArchivedEvents(db: Database, worldId: string, tick?: number): GameEvent[] {
  const rows =
    tick === undefined
      ? db.all<EventRow>(
          "SELECT tick, sequence, version, type, payload_json FROM archived_events WHERE world_id = ? ORDER BY tick, sequence",
          worldId,
        )
      : db.all<EventRow>(
          "SELECT tick, sequence, version, type, payload_json FROM archived_events WHERE world_id = ? AND tick = ? ORDER BY sequence",
          worldId,
          tick,
        );
  return rows.map((row) => ({
    tick: row.tick,
    sequence: row.sequence,
    version: 1,
    type: row.type,
    payload: JSON.parse(row.payload_json),
  })) as GameEvent[];
}

export function loadAvatarPaths(db: Database, worldId: string, tick: number): AvatarPath[] {
  return db
    .all<AvatarPathRow>(
      "SELECT player_id, path_json, returned_home FROM avatar_paths WHERE world_id = ? AND tick = ? ORDER BY player_id",
      worldId,
      tick,
    )
    .map((row) => JSON.parse(row.path_json) as AvatarPath);
}

/** Highest resolved tick for a world, or undefined before the first tick. */
export function latestResolvedTick(db: Database, worldId: string): number | undefined {
  const row = db.get<{ tick: number | null }>(
    "SELECT MAX(tick) AS tick FROM tick_logs WHERE world_id = ?",
    worldId,
  );
  return row?.tick ?? undefined;
}

/** The latest tick log, used to serve the replay endpoint (spec §10). */
export function loadLatestTickLog(db: Database, worldId: string): StoredTickLog | undefined {
  const tick = latestResolvedTick(db, worldId);
  return tick === undefined ? undefined : loadTickLog(db, worldId, tick);
}
