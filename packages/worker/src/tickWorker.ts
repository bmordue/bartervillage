/**
 * Tick poller (spec §14.1; M4.A02/M4.A03).
 *
 * Each poll tries the global tick lock. If another worker holds it, the poll
 * returns without resolving. Once the lock is held, the short-lived resolving
 * lease is taken in its own transaction; the lease and lock are released after
 * resolution succeeds or throws, and a crashed worker's lease expires by TTL.
 *
 * Persistent resolution failures are tracked in their own table (D.09): every
 * failed attempt is recorded per tick and, once the consecutive count reaches
 * the alert threshold (three by default), a structured alert is logged. The
 * poller keeps retrying on its normal cadence, and the host can also trigger a
 * safe manual retry through `retryWorldTick` or the REST endpoint.
 */

import {
  acquireResolvingLease,
  type Database,
  latestResolvedTick,
  loadWorld,
  releaseResolvingLease,
  resolveWorldTickInTransaction,
  recordTickResolutionFailure,
  clearTickResolutionFailure,
} from "@bartervillage/server";
import type { ResolveTickResult } from "@bartervillage/rules";
import { tryAcquireLock } from "./lock.js";

export interface TickContext {
  database: Database;
  worldId: string;
  tick: number;
}

/**
 * Called after a tick commits successfully, once the resolving lease and tick
 * lock are released (spec §14.9, §11; M4.A23, M7.13). Push failures here are
 * logged and never affect tick resolution.
 */

export interface TickAfterCommitResult {
  worldId: string;
  tick: number;
  stateHash: string;
}

export interface TickPollerOptions {
  database: Database;
  worldId: string;
  lockPath: string;
  owner: string;
  logger: (message: string) => void;
  resolve?: (context: TickContext) => ResolveTickResult | void;
  shouldResolve?: (context: TickContext & { now: Date }) => boolean;
  afterCommit?: (result: TickAfterCommitResult) => void | Promise<void>;
  now?: () => number;
  staleAfterMs?: number;
  leaseTtlMs?: number;
  /** Alert threshold for consecutive tick failures; defaults to 3 (D.09). */
  alertThreshold?: number;
}

export function createTickPoller(options: TickPollerOptions): () => Promise<void> {
  const resolve =
    options.resolve ??
    ((context: TickContext) => {
      return resolveWorldTickInTransaction(context.database, context.worldId);
    });

  return async () => {
    const lockLease = tryAcquireLock({
      path: options.lockPath,
      owner: options.owner,
      ...(options.now ? { now: options.now } : {}),
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
    });

    if (!lockLease) {
      options.logger(`worker: tick lock unavailable for world ${options.worldId}`);
      return;
    }

    const world = loadWorld(options.database, options.worldId);
    if (!world) {
      options.logger(`worker: world ${options.worldId} not found`);
      lockLease.release();
      return;
    }

    const nowMs = options.now ? options.now() : Date.now();
    const due =
      options.shouldResolve?.({
        database: options.database,
        worldId: options.worldId,
        tick: latestResolvedTick(options.database, options.worldId) ?? -1,
        now: new Date(nowMs),
      }) ?? true;
    if (!due) {
      options.logger(`worker: tick not due for world ${options.worldId}`);
      lockLease.release();
      return;
    }

    const resolvingLease = acquireResolvingLease(options.database, options.worldId, {
      owner: options.owner,
      ...(options.now ? { now: new Date(options.now()) } : {}),
      ...(options.leaseTtlMs === undefined ? {} : { ttlMs: options.leaseTtlMs }),
    });
    if (!resolvingLease) {
      options.logger(`worker: resolving lease unavailable for world ${options.worldId}`);
      lockLease.release();
      return;
    }

    let afterCommitResult: TickAfterCommitResult | null = null;
    try {
      const tick = latestResolvedTick(options.database, options.worldId) ?? -1;
      const attemptedTick = world.currentTick;
      options.database.raw.exec("BEGIN IMMEDIATE");
      try {
        const resolution = resolve({ database: options.database, worldId: options.worldId, tick });
        clearTickResolutionFailure(options.database, options.worldId, attemptedTick);
        options.database.raw.exec("COMMIT");
        if (resolution) {
          afterCommitResult = {
            worldId: options.worldId,
            tick: resolution.header.tick,
            stateHash: resolution.stateHash,
          };
        }
      } catch (error) {
        try {
          options.database.raw.exec("ROLLBACK");
        } catch {
          // The original error is more useful than a failed rollback.
        }
        // Record this tick failure in our persistent failure table (D.09).
        // The table is keyed by (world_id, tick) and tracks consecutive attempts.
        const newCount = recordTickResolutionFailure(
          options.database,
          options.worldId,
          attemptedTick,
          attemptedTick,
        );
        options.logger(
          `worker: tick ${options.worldId} tick ${attemptedTick} failed (attempts=${newCount})`,
        );
        const alertThreshold = options.alertThreshold ?? 3;
        if (newCount >= alertThreshold) {
          options.logger(
            `worker: ALERT [D.09] tick ${options.worldId} tick ${attemptedTick} reached ${newCount} consecutive failures`,
          );
        }
        throw error;
      }
    } finally {
      releaseResolvingLease(options.database, options.worldId, options.owner);
      lockLease.release();
    }
    // Send push notifications only after the lease and lock are released
    // (spec §14.9: release, then notify). Failures are logged only.
    if (afterCommitResult && options.afterCommit) {
      void Promise.resolve(options.afterCommit(afterCommitResult)).catch((error: unknown) => {
        options.logger(`worker: after-commit hook failed: ${String(error)}`);
      });
    }
  };
}
