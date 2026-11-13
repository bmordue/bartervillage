/**
 * Tick resolution failure tracking (spec §15; D.09, M4.A32).
 *
 * A persistent resolution bug would stall the world, so consecutive failures for
 * the same tick are counted in their own table. The count survives the failed
 * transaction's rollback because it is written afterwards, in a separate
 * statement. The host can inspect this table and trigger a safe manual retry.
 */

import type { Database } from "./database.js";

export interface TickResolutionFailure {
  worldId: string;
  tick: number;
  failureCount: number;
  lastFailureTick: number;
  resolved: boolean;
}

type FailureRow = {
  world_id: string;
  tick: number;
  failure_count: number;
  last_failure_tick: number;
  resolved: number;
};

/** Records a failure for `tick` and returns the new consecutive count. */
export function recordTickResolutionFailure(
  db: Database,
  worldId: string,
  tick: number,
  failureTick: number = tick,
): number {
  db.run(
    `INSERT INTO tick_resolution_failures (world_id, tick, failure_count, last_failure_tick)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(world_id, tick) DO UPDATE SET
       failure_count = failure_count + 1,
       last_failure_tick = excluded.last_failure_tick,
       resolved = 0`,
    worldId,
    tick,
    failureTick,
  );
  return loadTickResolutionFailure(db, worldId, tick)?.failureCount ?? 1;
}

/** Clears the failure streak for `tick` after a successful resolution. */
export function clearTickResolutionFailure(db: Database, worldId: string, tick: number): void {
  db.run(
    `UPDATE tick_resolution_failures
     SET resolved = 1
     WHERE world_id = ? AND tick = ?`,
    worldId,
    tick,
  );
}

export function loadTickResolutionFailure(
  db: Database,
  worldId: string,
  tick: number,
): TickResolutionFailure | undefined {
  const row = db.get<FailureRow>(
    "SELECT * FROM tick_resolution_failures WHERE world_id = ? AND tick = ?",
    worldId,
    tick,
  );
  if (!row) {
    return undefined;
  }
  return {
    worldId: row.world_id,
    tick: row.tick,
    failureCount: row.failure_count,
    lastFailureTick: row.last_failure_tick,
    resolved: row.resolved !== 0,
  };
}

/** Unresolved failure streaks, ordered by tick, for host inspection. */
export function loadActiveTickFailures(db: Database, worldId: string): TickResolutionFailure[] {
  return db
    .all<FailureRow>(
      `SELECT * FROM tick_resolution_failures
       WHERE world_id = ? AND resolved = 0
       ORDER BY tick`,
      worldId,
    )
    .map((row) => ({
      worldId: row.world_id,
      tick: row.tick,
      failureCount: row.failure_count,
      lastFailureTick: row.last_failure_tick,
      resolved: row.resolved !== 0,
    }));
}
