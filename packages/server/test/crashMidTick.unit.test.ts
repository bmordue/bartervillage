import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { content } from "@bartervillage/content";
import {
  MAP_GENERATOR_VERSION,
  RULES_VERSION,
  generateRegion,
  resolveTick,
} from "@bartervillage/rules";
import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  loadLatestTickLog,
  loadWorldState,
  persistMap,
  provisionStarterBuildings,
  resolveWorldTick,
  saveWorldState,
  type ResolveWorldTickOptions,
} from "../src/index.js";

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

function setup(contentVersion = content.version): {
  database: Database;
  databasePath: string;
  plotId: string;
  plotIds: string[];
  regionId: string;
} {
  directory = mkdtempSync(join(tmpdir(), "barter-resolution-"));
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
  const plot = generated.plots.find((candidate) => !candidate.worldOwned);
  if (!plot) {
    throw new Error("generated region has no player plot");
  }

  database.run(
    `INSERT INTO players (id, name, plot_id, joined_tick, energy)
     VALUES ('p1', 'Ada', ?, 0, 0)`,
    plot.id,
  );
  database.run("UPDATE plots SET player_id = 'p1' WHERE id = ?", plot.id);
  provisionStarterBuildings(database, plot.id);
  database.run(
    "INSERT INTO inventory (plot_id, item, quantity, locked) VALUES (?, 'grain', 5, 0)",
    plot.id,
  );

  return {
    database,
    databasePath,
    plotId: plot.id,
    plotIds: generated.plots.filter((candidate) => !candidate.worldOwned).map((plot) => plot.id),
    regionId: generated.region.id,
  };
}

function injectMidTickFailure(): ResolveWorldTickOptions {
  return {
    resolve: (input) => {
      const result = resolveTick(input);
      saveWorldState(db!, result.state);
      throw new Error("boom");
    },
  };
}

describe("crash mid-tick verification (M9.09)", () => {
  it("leaves world state unchanged when tick resolution throws mid-tick", () => {
    const { database, plotId } = setup();
    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const after = loadWorldState(database, "w1");
    expect(after?.world.currentTick).toBe(0);
    expect(after?.players[0]?.energy).toBe(0);
    expect(after?.inventory).toEqual([{ plotId, item: "grain", quantity: 5, locked: 0 }]);
  });

  it("no tick log entries written when tick resolution throws mid-tick", () => {
    const { database } = setup();
    database.run(
      "INSERT INTO tick_logs (world_id, tick, header_json, state_hash) VALUES ('w1', 0, '{}', 'manual')",
    );

    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const tickLogs = database.all<{ tick: number }>("SELECT tick FROM tick_logs");
    expect(tickLogs).toHaveLength(1);
    expect(tickLogs.every((row) => row.tick === 0)).toBe(true);
  });

  it("no archived events written when tick resolution throws mid-tick", () => {
    const { database } = setup();
    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const events = database.all<{ sequence: number; type: string }>(
      "SELECT sequence, type FROM archived_events WHERE world_id = 'w1'",
    );
    expect(events).toHaveLength(0);
  });

  it("no avatar paths written when tick resolution throws mid-tick", () => {
    const { database } = setup();
    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const avatarPaths = database.all<{ player_id: string }>(
      "SELECT player_id, path_json FROM avatar_paths WHERE world_id = 'w1'",
    );
    expect(avatarPaths).toHaveLength(0);
  });

  it("recovery: resolved tick can be re-resolved after crash", () => {
    const { database } = setup();
    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const after = loadWorldState(database, "w1");
    expect(after?.world.currentTick).toBe(0);

    const result = resolveWorldTick(database, "w1");
    const after2 = loadWorldState(database, "w1");
    expect(after2?.world.currentTick).toBe(1);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("replay log matches resolved state after recovery", () => {
    const { database } = setup();
    const options: ResolveWorldTickOptions = injectMidTickFailure();

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const result = resolveWorldTick(database, "w1");
    const log = loadLatestTickLog(database, "w1");

    expect(log).toBeDefined();
    expect(log?.tick).toBe(0);
    expect(log?.stateHash).toBe(result.stateHash);
    expect(log?.events).toEqual(result.events);
  });
});
