/**
 * World configuration persistence (spec §12, §14; M3.17).
 *
 * The world row pins a content version. A version change is only accepted while
 * no resolution is in progress, so a new version can never take effect
 * mid-tick: the next tick freezes and reads the newly pinned value.
 */

import type { ResolvingLease, Season, Weather, World, WorldConfig } from "@bartervillage/rules";
import type { Database } from "./database.js";

type WorldRow = {
  id: string;
  seed: string;
  generator_version: string;
  content_version: string;
  rules_version: string;
  deadline_time: string;
  timezone: string;
  min_tick_gap_minutes: number;
  player_cap: number;
  current_tick: number;
  season: Season;
  weather: Weather;
  next_deadline: string | null;
  resolving_owner: string | null;
  resolving_acquired_at: string | null;
  resolving_expires_at: string | null;
};

function toConfig(row: WorldRow): WorldConfig {
  return {
    seed: row.seed,
    generatorVersion: row.generator_version,
    contentVersion: row.content_version,
    rulesVersion: row.rules_version,
    deadlineTime: row.deadline_time,
    timezone: row.timezone,
    minTickGapMinutes: row.min_tick_gap_minutes,
    playerCap: row.player_cap,
  };
}

function toLease(row: WorldRow): ResolvingLease | null {
  if (row.resolving_owner === null) {
    return null;
  }
  return {
    owner: row.resolving_owner,
    acquiredAt: row.resolving_acquired_at ?? "",
    expiresAt: row.resolving_expires_at ?? "",
  };
}

export function loadWorld(db: Database, worldId: string): World | undefined {
  const row = db.get<WorldRow>("SELECT * FROM worlds WHERE id = ?", worldId);
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    config: toConfig(row),
    currentTick: row.current_tick,
    season: row.season,
    weather: row.weather,
    nextDeadline: row.next_deadline,
    resolving: toLease(row),
  };
}

/**
 * Re-pin a world's content version. Returns false when the world is missing or
 * a resolution is in progress, leaving the previous version in place.
 */
export function setContentVersion(db: Database, worldId: string, contentVersion: string): boolean {
  const result = db.run(
    "UPDATE worlds SET content_version = ? WHERE id = ? AND resolving_owner IS NULL",
    contentVersion,
    worldId,
  );
  return Number(result.changes) === 1;
}
