/**
 * Tick resolution service (spec §14; M4.A05).
 *
 * The caller owns the `BEGIN IMMEDIATE` transaction. This service loads the
 * complete world snapshot, runs the rules engine over it, writes the new state
 * and appends the tick log before the caller commits. Any exception leaves the
 * database at the previous tick.
 */

import { content as bundledContent } from "@bartervillage/content";
import {
  RULES_VERSION,
  VersionMismatchError,
  nextDeadlineFor,
  resolveTick,
  type Clock,
  type ContentPack,
  type ResolveTickInput,
  type ResolveTickResult,
  type WorldState,
} from "@bartervillage/rules";

import type { Database } from "./db/database.js";
import { loadWorldState, saveWorldState } from "./db/stateRepository.js";
import { writeTickLog } from "./db/tickRepository.js";

export class WorldNotFoundError extends Error {
  constructor(worldId: string) {
    super(`World ${worldId} not found`);
    this.name = "WorldNotFoundError";
  }
}

export interface ResolveWorldTickOptions {
  content?: ContentPack;
  /** Wall clock used only to schedule the next deadline. */
  clock?: Clock;
  /** Test seam for injecting a failure or an alternate engine. */
  resolve?: (input: ResolveTickInput) => ResolveTickResult;
}

function assertPinnedVersions(state: WorldState, content: ContentPack): void {
  if (state.world.config.contentVersion !== content.version) {
    throw new VersionMismatchError(
      `Content version mismatch: pinned ${state.world.config.contentVersion}, current ${content.version}`,
    );
  }
  if (state.world.config.rulesVersion !== RULES_VERSION) {
    throw new VersionMismatchError(
      `Rules version mismatch: pinned ${state.world.config.rulesVersion}, current ${RULES_VERSION}`,
    );
  }
}

/**
 * Resolve one tick inside the caller's open transaction. The state hash, event
 * log and replacement world state are written before returning.
 */
export function resolveWorldTickInTransaction(
  db: Database,
  worldId: string,
  options: ResolveWorldTickOptions = {},
): ResolveTickResult {
  const state = loadWorldState(db, worldId);
  if (!state) {
    throw new WorldNotFoundError(worldId);
  }
  const content = options.content ?? bundledContent;
  assertPinnedVersions(state, content);

  const result = (options.resolve ?? resolveTick)({ state, content });
  result.state.world.nextDeadline = nextDeadlineFor({
    timezone: state.world.config.timezone,
    deadlineTime: state.world.config.deadlineTime,
    minTickGapMinutes: state.world.config.minTickGapMinutes,
    now: options.clock?.now() ?? new Date(),
  });
  saveWorldState(db, result.state);
  writeTickLog(db, {
    worldId,
    tick: result.header.tick,
    header: result.header,
    stateHash: result.stateHash,
    events: result.events,
  });
  return result;
}

/** Resolve one tick in its own `BEGIN IMMEDIATE` transaction. */
export function resolveWorldTick(
  db: Database,
  worldId: string,
  options: ResolveWorldTickOptions = {},
): ResolveTickResult {
  return db.transaction(() => resolveWorldTickInTransaction(db, worldId, options));
}
