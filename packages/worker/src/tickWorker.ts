/**
 * Tick poller (spec §14.1; M4.A02).
 *
 * Each poll tries the global tick lock. If another worker holds it, the poll
 * returns without resolving. The lease is always released, including when
 * resolution throws, so the next poll can retry.
 */

import { type Database, latestResolvedTick, loadWorld } from "@bartervillage/server";

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
}

export function createTickPoller(options: TickPollerOptions): () => Promise<void> {
  const resolve = options.resolve ?? (() => undefined);

  return async () => {
    const lease = tryAcquireLock({
      path: options.lockPath,
      owner: options.owner,
      ...(options.now ? { now: options.now } : {}),
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
    });

    if (!lease) {
      options.logger(`worker: tick lock unavailable for world ${options.worldId}`);
      return;
    }

    try {
      const world = loadWorld(options.database, options.worldId);
      if (!world) {
        options.logger(`worker: world ${options.worldId} not found`);
        return;
      }
      const tick = latestResolvedTick(options.database, options.worldId) ?? -1;
      await resolve({ database: options.database, worldId: options.worldId, tick });
    } finally {
      lease.release();
    }
  };
}
