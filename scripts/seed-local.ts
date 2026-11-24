import { content } from "@bartervillage/content";
import { generateRegion, MAP_GENERATOR_VERSION, RULES_VERSION } from "@bartervillage/rules";
import { claimSite, Database, persistMap } from "@bartervillage/server";

const WORLD_ID = "w1";
const PLAYER_ID = "p1";
const PLAYER_NAME = "You";
const SEED = "local-seed";

const databasePath = process.env.DATABASE_PATH ?? "./barter-village.sqlite";
const database = Database.open({ path: databasePath });

try {
  const existingWorld = database.get<{ id: string }>(
    "SELECT id FROM worlds WHERE id = ?",
    WORLD_ID,
  );

  if (existingWorld) {
    console.log(`Local world ${WORLD_ID} already exists in ${databasePath}`);
  } else {
    database.run(
      `INSERT INTO worlds
         (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
          min_tick_gap_minutes, player_cap, current_tick, season, weather)
       VALUES (?, ?, ?, ?, ?, '20:00', 'UTC', 60, 20, 0, 'spring', 'clear')`,
      WORLD_ID,
      SEED,
      MAP_GENERATOR_VERSION,
      content.version,
      RULES_VERSION,
    );
    persistMap(database, [generateRegion(SEED, MAP_GENERATOR_VERSION, 0, 0, content)]);
    console.log(`Created local world ${WORLD_ID} in ${databasePath}`);
  }

  const existingPlayer = database.get<{ id: string }>(
    "SELECT id FROM players WHERE id = ?",
    PLAYER_ID,
  );

  if (existingPlayer) {
    console.log(`Local player ${PLAYER_ID} already exists`);
  } else {
    const plot = database.get<{ id: string }>(
      "SELECT id FROM plots WHERE world_owned = 0 AND player_id IS NULL ORDER BY id LIMIT 1",
    );
    if (!plot) {
      throw new Error("No unclaimed plot available to seed a local player");
    }
    database.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, 100)`,
      PLAYER_ID,
      PLAYER_NAME,
      plot.id,
    );
    if (!claimSite(database, PLAYER_ID, plot.id)) {
      throw new Error(`Could not claim plot ${plot.id}`);
    }
    console.log(`Created local player ${PLAYER_ID} on plot ${plot.id}`);
  }

  console.log(`Open http://localhost:5173/?player=${PLAYER_ID}`);
} finally {
  database.close();
}
