/**
 * API/database integration-test harness (CT.05).
 *
 * Gives each test a migrated file-backed SQLite database (so WAL and writer
 * locks behave like production) plus a REST server on an ephemeral port.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiServerOptions, RunningApiServer } from "../../src/api.js";
import { startApiServer } from "../../src/api.js";
import { Database } from "../../src/db/database.js";

export interface TestApi {
  database: Database;
  databasePath: string;
  api: RunningApiServer;
  baseUrl: string;
  close: () => Promise<void>;
}

export interface TestApiOptions extends ApiServerOptions {
  buildRoutes?: (database: Database) => ApiServerOptions["routes"];
}

export async function startTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const directory = mkdtempSync(join(tmpdir(), "barter-api-"));
  const databasePath = join(directory, "test.sqlite");
  const database = Database.open({ path: databasePath });
  const { buildRoutes, ...serverOptions } = options;

  let api: RunningApiServer;
  try {
    api = await startApiServer({
      ...serverOptions,
      ...(buildRoutes ? { routes: buildRoutes(database) } : {}),
      port: 0,
    });
  } catch (error) {
    database.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    database,
    databasePath,
    api,
    baseUrl: `http://127.0.0.1:${api.port}`,
    close: async () => {
      await api.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function insertWorld(database: Database, id = "w1"): void {
  database.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, season, weather)
     VALUES (?, 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear')`,
    id,
  );
}
