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
  resolveWorldTickInTransaction,
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

describe("world state repository", () => {
  it("round-trips a complete snapshot through the database", () => {
    const { database } = setup();
    const before = loadWorldState(database, "w1");
    expect(before).toBeDefined();

    saveWorldState(database, before!);

    expect(loadWorldState(database, "w1")).toEqual(before);
  });
});

describe("transactional tick resolution", () => {
  it("resolves the tick and commits the state plus tick log together", () => {
    const { database, plotId } = setup();

    const result = resolveWorldTick(database, "w1");
    const after = loadWorldState(database, "w1");
    const log = loadLatestTickLog(database, "w1");

    expect(result.header.tick).toBe(0);
    expect(after?.world.currentTick).toBe(1);
    expect(after?.players[0]?.energy).toBe(content.energy.dailyBudget);
    expect(after?.inventory).toEqual([{ plotId, item: "grain", quantity: 5, locked: 0 }]);
    expect(log?.tick).toBe(0);
    expect(log?.header).toEqual(result.header);
    expect(log?.stateHash).toBe(result.stateHash);
    expect(log?.events).toEqual(result.events);
    expect(log?.events.length).toBeGreaterThan(0);
  });

  it("leaves the previous tick intact when writing the tick log fails", () => {
    const { database, plotId } = setup();
    database.run(
      "INSERT INTO tick_logs (world_id, tick, header_json, state_hash) VALUES ('w1', 0, '{}', 'manual')",
    );

    expect(() => resolveWorldTick(database, "w1")).toThrow();

    const after = loadWorldState(database, "w1");
    expect(after?.world.currentTick).toBe(0);
    expect(after?.world.weather).toBe("clear");
    expect(after?.players[0]?.energy).toBe(0);
    expect(after?.inventory).toEqual([{ plotId, item: "grain", quantity: 5, locked: 0 }]);
    expect(database.all("SELECT tick FROM tick_logs")).toHaveLength(1);
    expect(database.all("SELECT sequence FROM archived_events")).toHaveLength(0);
  });

  it("rolls back writes made before an injected resolution failure", () => {
    const { database } = setup();
    const options: ResolveWorldTickOptions = {
      resolve: (input) => {
        const result = resolveTick(input);
        saveWorldState(database, result.state);
        throw new Error("boom");
      },
    };

    expect(() => resolveWorldTick(database, "w1", options)).toThrow("boom");

    const after = loadWorldState(database, "w1");
    expect(after?.world.currentTick).toBe(0);
    expect(after?.players[0]?.energy).toBe(0);
    expect(database.all("SELECT tick FROM tick_logs")).toHaveLength(0);
  });

  it("runs queued contributions through the goal phase and persists rewards", () => {
    const { database } = setup();
    const reward = content.recipes[0]?.id;
    if (!reward) {
      throw new Error("content has no recipes");
    }
    database.run(
      `INSERT INTO goals
         (id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick, status)
       VALUES ('g1', 'festival', 'Festival', ?, ?, 0, 10, 'active')`,
      JSON.stringify([{ item: "grain", quantity: 5 }]),
      JSON.stringify([{ kind: "recipe", id: reward }]),
    );
    database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('o-goal', 'p1', 0, 1, 'contribute_goal', ?, 'queued')`,
      JSON.stringify({ goalId: "g1", items: [{ item: "grain", quantity: 5 }] }),
    );

    const result = resolveWorldTick(database, "w1");
    const after = loadWorldState(database, "w1");

    expect(after?.goals[0]?.status).toBe("succeeded");
    expect(after?.inventory.find((row) => row.item === "grain")).toBeUndefined();
    expect(after?.unlockedRecipes).toContain(reward);
    expect(result.events.some((event) => event.type === "goal_completed")).toBe(true);
  });

  it("applies wild claims in the claim phase and stores the yield", () => {
    const { database } = setup();
    const node = database.get<{ id: string; resource: string; amount: number }>(
      "SELECT id, resource, amount FROM wild_nodes WHERE amount > 0 ORDER BY id LIMIT 1",
    );
    if (!node) {
      throw new Error("generated map has no wild node with yield");
    }
    database.run(
      "INSERT INTO wild_claims (player_id, node_id, tick, sequence) VALUES ('p1', ?, 0, 1)",
      node.id,
    );

    const result = resolveWorldTick(database, "w1");
    const after = loadWorldState(database, "w1");

    expect(after?.wildNodes.find((candidate) => candidate.id === node.id)?.amount).toBeLessThan(
      node.amount,
    );
    expect(
      after?.inventory.find((row) => row.item === node.resource)?.quantity ?? 0,
    ).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === "node_claimed")).toBe(true);
  });

  it("freezes the roster for the tick and admits later players next tick", () => {
    const { database, databasePath, plotIds, regionId } = setup();
    const other = Database.open({ path: databasePath, busyTimeoutMs: 0 });
    try {
      const result = resolveWorldTick(database, "w1", {
        resolve: (input) => {
          expect(() =>
            other.run(
              `INSERT INTO players (id, name, plot_id, joined_tick, energy)
               VALUES ('late', 'Late', 'late-plot', 0, 0)`,
            ),
          ).toThrow();
          expect(() =>
            other.run("UPDATE worlds SET content_version = '9.9.9' WHERE id = 'w1'"),
          ).toThrow();
          return resolveTick(input);
        },
      });
      expect(result.state.players.map((player) => player.id)).toEqual(["p1"]);
    } finally {
      other.close();
    }

    const latePlot = plotIds[1];
    if (!latePlot) {
      throw new Error("expected a second free plot");
    }
    database.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES ('late', 'Late', ?, 1, 0)`,
      latePlot,
    );
    database.run("UPDATE plots SET player_id = 'late' WHERE id = ?", latePlot);
    database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('late-order', 'late', 1, 1, 'travel', ?, 'queued')`,
      JSON.stringify({ regionId }),
    );

    const next = resolveWorldTick(database, "w1");
    expect(next.state.players.map((player) => player.id)).toEqual(["late", "p1"]);
    expect(
      next.events.some(
        (event) => event.type === "order_resolved" && event.payload.playerId === "late",
      ),
    ).toBe(true);
  });

  it("refuses to resolve when the pinned content version does not match", () => {
    const { database } = setup("0.0.0");

    expect(() => resolveWorldTickInTransaction(database, "w1")).toThrow("Content version mismatch");
    expect(loadWorldState(database, "w1")?.world.currentTick).toBe(0);
  });
});
