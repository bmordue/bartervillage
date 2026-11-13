/**
 * 28‑tick soak and performance harness for CT.07 (spec §3).
 *
 * Runs 20 players with full order queues over a 28‑tick soak; measures
 * resolution time per tick and asserts p95 under 60 seconds.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { content } from "@bartervillage/content";
import { MAP_GENERATOR_VERSION, RULES_VERSION, generateRegion } from "@bartervillage/rules";
import { afterEach, describe, expect, it } from "vitest";

import { Database, persistMap, provisionStarterBuildings, resolveWorldTick } from "../src/index.js";

let db: Database | undefined;
let directory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function setupWithPlayerCount(
  playerCount: number,
  contentVersion = content.version,
): {
  database: Database;
  databasePath: string;
  plotIds: string[];
} {
  directory = mkdtempSync(join(tmpdir(), "barter-soak-"));
  const databasePath = join(directory, "world.sqlite");
  const database = Database.open({ path: databasePath });
  db = database;

  database.run(
    `INSERT INTO worlds
       (id, seed, generator_version, content_version, rules_version, deadline_time, timezone,
        min_tick_gap_minutes, player_cap, current_tick, season, weather)
     VALUES ('w1', 'seed', ?, ?, ?, '20:00', 'UTC', 60, 20, 0, 'spring', 'clear')`,
    MAP_GENERATOR_VERSION,
    contentVersion,
    RULES_VERSION,
  );

  const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
  persistMap(database, [generated]);

  const playerPlots = generated.plots.filter((plot) => !plot.worldOwned);
  const playerCountActual = Math.min(playerCount, playerPlots.length);
  const plotIds = playerPlots.slice(0, playerCountActual).map((p) => p.id);

  let sequence = 1;
  for (let i = 0; i < playerCountActual; i += 1) {
    const plot = playerPlots[i];
    database.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, ?)`,
      `p${i + 1}`,
      `Player ${i + 1}`,
      plot.id,
      content.energy.dailyBudget,
    );
    database.run("UPDATE plots SET player_id = ? WHERE id = ?", `p${i + 1}`, plot.id);
    provisionStarterBuildings(database, plot.id);
    database.run(
      "INSERT INTO inventory (plot_id, item, quantity, locked) VALUES (?, 'grain', 5, 0)",
      plot.id,
    );
    for (let tick = 0; tick < 28; tick += 1) {
      database.run(
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

  return { database, databasePath, plotIds };
}

describe("28-tick soak (CT.07)", () => {
  it("runs 20 players with full order queues over 28 ticks and resolves each tick under 60 seconds (p95)", () => {
    const { database } = setupWithPlayerCount(20);
    const resolutions: number[] = [];

    for (let tick = 0; tick < 28; tick += 1) {
      const start = performance.now();
      const result = resolveWorldTick(database, "w1");
      const elapsed = performance.now() - start;
      resolutions.push(elapsed);
      if (!result.header) {
        throw new Error(`Tick ${tick} resolution produced no header`);
      }
    }

    const sorted = [...resolutions].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95 = sorted[p95Index];

    expect(sorted).toHaveLength(28);
    expect(p95).toBeLessThan(60000);
  });
});
