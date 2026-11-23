/**
 * Soak test result recorder (M9.07; spec §3).
 *
 * This test runs the 28-tick soak and records the p95 tick-resolution
 * time in a results file. The p95 must be under 60 seconds.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { content } from "@bartervillage/content";
import { MAP_GENERATOR_VERSION, RULES_VERSION, generateRegion } from "@bartervillage/rules";
import { Database } from "../src/db/database.js";
import { persistMap } from "../src/db/mapRepository.js";
import { provisionStarterBuildings } from "../src/db/playerRepository.js";
import { resolveWorldTick } from "../src/resolution.js";

let db: Database | undefined;
let directory: string | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "barter-soak-record-"));
});

afterEach(() => {
  db?.close();
  db = undefined;
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function setupWithPlayerCount(playerCount: number, databasePath: string): void {
  db = Database.open({ path: databasePath });

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
    db!.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, ?)`,
      `p${i + 1}`,
      `Player ${i + 1}`,
      plot.id,
      content.energy.dailyBudget,
    );
    db!.run("UPDATE plots SET player_id = ? WHERE id = ?", `p${i + 1}`, plot.id);
    provisionStarterBuildings(db!, plot.id);
    db!.run(
      "INSERT INTO inventory (plot_id, item, quantity, locked) VALUES (?, 'grain', 5, 0)",
      plot.id,
    );
    for (let tick = 0; tick < 28; tick += 1) {
      db!.run(
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
}

describe("28-tick soak result recording (M9.07)", () => {
  it("runs 20 players over 28 ticks and records p95 < 60s", () => {
    if (!directory) throw new Error("directory not set");
    const databasePath = join(directory, "world.sqlite");
    setupWithPlayerCount(20, databasePath);
    const resolutions: number[] = [];

    for (let tick = 0; tick < 28; tick += 1) {
      const start = performance.now();
      const result = resolveWorldTick(db!, "w1");
      const elapsed = performance.now() - start;
      resolutions.push(elapsed);
      if (!result.header) {
        throw new Error(`Tick ${tick} resolution produced no header`);
      }
    }

    const sorted = [...resolutions].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95 = sorted[p95Index];

    expect(p95).toBeLessThan(60000);

    // Record the result
    const resultPath = join(directory, "soak-result.json");
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          p95Ms: p95,
          p95Seconds: p95 / 1000,
          maxMs: Math.max(...resolutions),
          minMs: Math.min(...resolutions),
          resolutions,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log(`M9.07 soak result: p95 = ${p95.toFixed(2)} ms (${(p95 / 1000).toFixed(2)} s)`);
  });
});
