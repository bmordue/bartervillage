/**
 * Tick trigger (spec §4.1; M4.A28).
 *
 * A tick starts when every player is ready for the current tick, or when the
 * scheduled deadline has passed. The poller runs immediately and every 60
 * seconds, so the start lands within one poll of the trigger.
 */

import { loadWorld } from "@bartervillage/server";
import type { Database } from "@bartervillage/server";

export interface TickIsDueInput {
  playerCount: number;
  readyCount: number;
  nextDeadline: string | null;
  now: Date;
}

export function tickIsDue(input: TickIsDueInput): boolean {
  if (input.playerCount <= 0) {
    return false;
  }
  if (input.readyCount >= input.playerCount) {
    return true;
  }
  if (input.nextDeadline === null) {
    return false;
  }
  const deadline = Date.parse(input.nextDeadline);
  return Number.isFinite(deadline) && deadline <= input.now.getTime();
}

export function isTickDue(database: Database, worldId: string, now: Date): boolean {
  const world = loadWorld(database, worldId);
  if (!world) {
    return false;
  }
  const players = database.get<{ count: number }>("SELECT COUNT(*) AS count FROM players");
  const ready = database.get<{ count: number }>(
    "SELECT COUNT(DISTINCT player_id) AS count FROM ready WHERE tick = ?",
    world.currentTick,
  );
  return tickIsDue({
    playerCount: players?.count ?? 0,
    readyCount: ready?.count ?? 0,
    nextDeadline: world.nextDeadline,
    now,
  });
}
