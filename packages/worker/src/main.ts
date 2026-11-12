/**
 * Tick worker process entry point (spec §12, §14; M4.A01/M4.A02).
 *
 * Deployment runs this as its own Node process under systemd. Configuration is
 * read from the environment; the poller takes the global tick lock and the
 * following M4.A tasks add the resolving lease and state persistence.
 */

import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { Database, resolveWorldTickInTransaction } from "@bartervillage/server";

import { DEFAULT_POLL_INTERVAL_MS, WorkerLoop } from "./loop.js";
import { createTickPoller } from "./tickWorker.js";

export async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH ?? "barter-village.sqlite";
  const worldId = process.env.WORLD_ID ?? "village";
  const lockPath = process.env.TICK_LOCK_PATH ?? join(dirname(databasePath), "tick.lock");
  const intervalMs = Number.parseInt(
    process.env.POLL_INTERVAL_MS ?? String(DEFAULT_POLL_INTERVAL_MS),
    10,
  );
  const database = Database.open({ path: databasePath });
  const logger = (message: string): void => {
    console.log(message);
  };
  const loop = new WorkerLoop({
    poll: createTickPoller({
      database,
      worldId,
      lockPath,
      owner: `${hostname()}:${process.pid}`,
      logger,
      resolve: (context) => {
        const result = resolveWorldTickInTransaction(context.database, context.worldId);
        logger(`worker: resolved world ${context.worldId} tick ${result.header.tick}`);
      },
    }),
    intervalMs,
    logger: (message) => console.error(message),
  });

  logger(`tick worker started; polling every ${intervalMs}ms`);
  loop.start();

  const shutdown = async (): Promise<void> => {
    await loop.stop();
    database.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
