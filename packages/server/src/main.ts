/**
 * API process entry point (spec §12; M4.B01).
 *
 * Configuration comes from the environment so deployment keeps secrets out of
 * the repository: `PORT`, `HOST` and (from M4.B02) `DATABASE_PATH`.
 */

import { startApiServer } from "./api.js";
import { Database } from "./db/database.js";
import { buildApiRoutes } from "./api.js";

export async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const database = Database.open(
    process.env.DATABASE_PATH ? { path: process.env.DATABASE_PATH } : {},
  );
  const running = await startApiServer({
    port,
    host,
    logger: (message) => console.error(message),
    routes: buildApiRoutes(database),
  });

  console.log(`API listening on http://${host}:${running.port}`);

  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
