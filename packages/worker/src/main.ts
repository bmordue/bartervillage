/**
 * Tick worker process entry point (spec §12, §14; M4.A01).
 *
 * Deployment runs this as its own Node process under systemd. Configuration is
 * read from the environment; resolution is added by the following M4.A tasks.
 */

import { Database, latestResolvedTick, loadWorld } from "@bartervillage/server";

import { DEFAULT_POLL_INTERVAL_MS, WorkerLoop } from "./loop.js";

export interface HeartbeatPollerOptions {
  database: Database;
  worldId: string;
  logger: (message: string) => void;
}

export function createHeartbeatPoller(options: HeartbeatPollerOptions): () => void {
  return () => {
    const world = loadWorld(options.database, options.worldId);
    if (!world) {
      options.logger(`worker: world ${options.worldId} not found`);
      return;
    }
    const tick = latestResolvedTick(options.database, options.worldId) ?? -1;
    options.logger(`worker: world ${options.worldId} idle at tick ${tick}`);
  };
}

export async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH ?? "barter-village.sqlite";
  const worldId = process.env.WORLD_ID ?? "village";
  const intervalMs = Number.parseInt(
    process.env.POLL_INTERVAL_MS ?? String(DEFAULT_POLL_INTERVAL_MS),
    10,
  );
  const database = Database.open({ path: databasePath });
  const logger = (message: string): void => {
    console.log(message);
  };
  const loop = new WorkerLoop({
    poll: createHeartbeatPoller({ database, worldId, logger }),
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
