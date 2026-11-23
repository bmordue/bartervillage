/**
 * 28-tick soak runner (M9.07; spec §3).
 *
 * Runs 20 players with full order queues over 28 ticks and records
 * the p95 tick-resolution time. Closes issue #9.
 *
 * Usage: npx tsx scripts/run-soak.ts
 *
 * Dependencies (all complete):
 *   - CT.07: soak harness (existing test)
 *   - M4.A33: benchmark under 60s p95
 *   - M9.02: VPS deployment with HTTPS / stable WebAuthn RP ID
 */

import { rmSync } from "node:fs";
import { join } from "node:path";

import { content } from "@bartervillage/content";
import { MAP_GENERATOR_VERSION, RULES_VERSION, generateRegion } from "@bartervillage/rules";
import { Database } from "../packages/server/src/db/database.js";
import { persistMap } from "../packages/server/src/db/mapRepository.js";
import { provisionStarterBuildings } from "../packages/server/src/db/playerRepository.js";
import { resolveWorldTick } from "../packages/server/src/resolution.js";

function setupWithPlayerCount(
  playerCount: number,
  databasePath: string,
): {
  database: Database;
} {
  const db = Database.open({ path: databasePath });

  // Insert world record
  db.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, current_tick, season, weather)
    VALUES ('w1', 'seed', ?, ?, ?, '20:00', 'UTC', 60, 20, 0, 'spring', 'clear')`,
    MAP_GENERATOR_VERSION,
    content.version,
    RULES_VERSION,
  );

  const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
  persistMap(db, [generated]);

  const playerPlots = generated.plots.filter((plot) => !plot.worldOwned);
  const playerCountActual = Math.min(playerCount, playerPlots.length);

  let sequence = 1;
  for (let i = 0; i < playerCountActual; i += 1) {
    const plot = playerPlots[i];
    db.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, ?)`,
      `p${i + 1}`,
      `Player ${i + 1}`,
      plot.id,
      content.energy.dailyBudget,
    );
    db.run("UPDATE plots SET player_id = ? WHERE id = ?", `p${i + 1}`, plot.id);
    provisionStarterBuildings(db, plot.id);
    db.run(
      "INSERT INTO inventory (plot_id, item, quantity, locked) VALUES (?, 'grain', 5, 0)",
      plot.id,
    );
    for (let tick = 0; tick < 28; tick += 1) {
      db.run(
        `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
        `order-${i}-${tick}-${sequence}`,
        `p${i + 1}`,
        tick,
        sequence,
        "forage",
        JSON.stringify({ nodeId: "some-node" }),
      );
      sequence += 1;
    }
  }

  return { database: db };
}

async function runSoak(): Promise<void> {
  const databasePath = join(process.cwd(), "soak-test.sqlite");
  const { database } = setupWithPlayerCount(20, databasePath);
  const resolutions: number[] = [];

  try {
    for (let tick = 0; tick < 28; tick += 1) {
      const start = performance.now();
      const result = resolveWorldTick(database, "w1");
      const elapsed = performance.now() - start;
      resolutions.push(elapsed);
      if (!result.header) {
        throw new Error(`Tick ${tick} resolution produced no header`);
      }
    }
  } finally {
    database.close();
    rmSync(join(process.cwd(), "soak-test.sqlite"), { force: true });
    // Clean up temp directory if it's the one we created
    // (We use a fixed path so the temp dir from setup can be cleaned)
  }

  const sorted = [...resolutions].sort((a, b) => a - b);
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;
  const p95 = sorted[p95Index];

  console.log(`28-tick soak with 20 players:`);
  console.log(`  Tick resolutions (ms): ${resolutions.join(", ")}`);
  console.log(`  p95: ${p95.toFixed(2)} ms (${(p95 / 1000).toFixed(2)} seconds)`);
  console.log(`  p95 < 60000 ms: ${p95 < 60000}`);
  console.log(`  Max: ${Math.max(...resolutions).toFixed(2)} ms`);
  console.log(`  Min: ${Math.min(...resolutions).toFixed(2)} ms`);

  if (p95 >= 60000) {
    console.error(`FAIL: p95 (${(p95 / 1000).toFixed(2)}s) is not under 60 seconds`);
    process.exitCode = 1;
  } else {
    console.log("PASS: p95 under 60 seconds");
  }
}

runSoak().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
