/**
 * Safe manual retry for a stalled tick (spec §15; D.09, M4.A32).
 *
 * The host can call this when the tick poller has alerted on three consecutive
 * failures for the same tick. The retry re-runs resolution for the current
 * tick only, with the same atomic transaction semantics as the worker.
 */

import type { Database } from "./db/database.js";
import { clearTickResolutionFailure } from "./db/tickFailureRepository.js";
import {
  loadWorld,
  isResolutionInProgress,
  acquireResolvingLease,
  releaseResolvingLease,
} from "./db/worldRepository.js";
import { resolveWorldTickInTransaction } from "./resolution.js";

export interface RetryResult {
  success: boolean;
  tick: number;
  stateHash?: string;
  error?: string;
}

/**
 * Attempt to resolve `world.currentTick` manually. Returns an object
 * indicating success or failure. Requires no resolving lease held.
 *
 * When `expectedTick` is supplied (the tick named in the admin URL) it must
 * match the world's current tick, so a stale request cannot re-resolve an
 * already-advanced tick.
 */
export function retryWorldTick(db: Database, worldId: string, expectedTick?: number): RetryResult {
  const world = loadWorld(db, worldId);
  if (!world) {
    return { success: false, tick: -1, error: "world_not_found" };
  }
  if (expectedTick !== undefined && expectedTick !== world.currentTick) {
    return { success: false, tick: world.currentTick, error: "tick_mismatch" };
  }
  if (isResolutionInProgress(world)) {
    return { success: false, tick: world.currentTick, error: "tick_in_progress" };
  }

  const tick = world.currentTick;

  // Acquire resolving lease in a separate statement
  const lease = acquireResolvingLease(db, worldId, { owner: "manual-retry" });
  if (!lease) {
    return { success: false, tick, error: "could_not_acquire_resolving_lease" };
  }

  try {
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = resolveWorldTickInTransaction(db, worldId);
      clearTickResolutionFailure(db, worldId, tick);
      db.raw.exec("COMMIT");
      return { success: true, tick: result.header.tick, stateHash: result.stateHash };
    } catch (error) {
      try {
        db.raw.exec("ROLLBACK");
      } catch {
        // The original error is more useful.
      }
      return { success: false, tick, error: String(error) };
    }
  } finally {
    releaseResolvingLease(db, worldId, "manual-retry");
  }
}
