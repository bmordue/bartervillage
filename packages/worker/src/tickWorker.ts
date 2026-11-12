/**
 * Tick poller (spec §14.1; M4.A02/M4.A03).
 *
 * Each poll tries the global tick lock. If another worker holds it, the poll
 * returns without resolving. Once the lock is held, the short-lived resolving
 * lease is taken in its own transaction; the lease and lock are released after
 * resolution succeeds or throws, and a crashed worker's lease expires by TTL.
 */

import {
  acquireResolvingLease,
  type Database,
  latestResolvedTick,
  loadWorld,
  releaseResolvingLease,
} from "@bartervillage/server";

import { tryAcquireLock } from "./lock.js";

export interface TickContext {
  database: Database;
  worldId: string;
  tick: number;
}

export interface TickPollerOptions {
  database: Database;
  worldId: string;
  lockPath: string;
  owner: string;
  logger: (message: string) => void;
  resolve?: (context: TickContext) => void | Promise<void>;
  now?: () => number;
  staleAfterMs?: number;
  leaseTtlMs?: number;
}

export function createTickPoller(options: TickPollerOptions): () => Promise<void> {
  const resolve = options.resolve ?? (() => undefined);

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

    try {
      const tick = latestResolvedTick(options.database, options.worldId) ?? -1;
      await resolve({ database: options.database, worldId: options.worldId, tick });
    } finally {
      releaseResolvingLease(options.database, options.worldId, options.owner);
      lockLease.release();
    }
  };
}
