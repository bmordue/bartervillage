/**
 * Mutation guard for the resolving lease (spec §14.9; M4.B05).
 *
 * While a tick is resolving, mutations return 409 instead of racing the
 * worker. During the resolution transaction itself SQLite's writer lock blocks
 * mutations as well; this guard covers the lease window before and after it.
 */

import type { RouteHandler } from "./api.js";
import type { Database } from "./db/database.js";
import { isResolutionInProgress, loadWorld } from "./db/worldRepository.js";

export type MutationCheck =
  { allowed: true } | { allowed: false; status: 404 | 409; body: { error: string } };

export function checkMutationAllowed(
  database: Database,
  worldId: string,
  now: Date = new Date(),
): MutationCheck {
  const world = loadWorld(database, worldId);
  if (!world) {
    return { allowed: false, status: 404, body: { error: "world_not_found" } };
  }
  if (isResolutionInProgress(world, now)) {
    return { allowed: false, status: 409, body: { error: "tick_in_progress" } };
  }
  return { allowed: true };
}

export interface GuardMutationOptions {
  database: Database;
  worldId: string;
  now?: () => Date;
}

/** Wrap a mutation route so it returns 404/409 before touching state. */
export function guardMutation(handler: RouteHandler, options: GuardMutationOptions): RouteHandler {
  return (request) => {
    const check = checkMutationAllowed(
      options.database,
      options.worldId,
      options.now?.() ?? new Date(),
    );
    if (!check.allowed) {
      return { status: check.status, body: check.body };
    }
    return handler(request);
  };
}
