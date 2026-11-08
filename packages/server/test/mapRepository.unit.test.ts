import { afterEach, describe, expect, it } from "vitest";
import { content } from "@bartervillage/content";
import { generateRegion, MAP_GENERATOR_VERSION } from "@bartervillage/rules";
import { Database } from "../src/db/database.js";
import { claimSite } from "../src/db/playerRepository.js";
import {
  claimPlot,
  loadPlots,
  loadRegions,
  loadTiles,
  loadWildNodes,
  persistMap,
} from "../src/db/mapRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("map persistence", () => {
  it("round-trips a generated region", () => {
    db = Database.open();
    const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    persistMap(db, [generated]);
    expect(loadRegions(db)).toEqual([generated.region]);
    expect(loadTiles(db)).toHaveLength(generated.tiles.length);
    expect(loadPlots(db)).toHaveLength(generated.plots.length);
    expect(loadWildNodes(db)).toHaveLength(generated.wildNodes.length);
  });

  it("never overwrites existing rows", () => {
    db = Database.open();
    const first = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    persistMap(db, [first]);
    const plot = loadPlots(db)[0];
    expect(plot).toBeDefined();
    db.run("UPDATE plots SET site_x = 999 WHERE id = ?", plot!.id);

    persistMap(db, [first]);
    expect(loadPlots(db).find((entry) => entry.id === plot!.id)?.siteX).toBe(999);
  });

  it("keeps regions independent when appending", () => {
    db = Database.open();
    const a = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    const b = generateRegion("seed", MAP_GENERATOR_VERSION, 1, 0, content);
    persistMap(db, [a, b]);
    expect(loadRegions(db).map((region) => region.id)).toEqual([a.region.id, b.region.id]);
    expect(loadTiles(db).filter((tile) => tile.regionId === a.region.id)).toEqual(a.tiles);
  });
});

describe("site claims", () => {
  it("is first-write-wins", () => {
    db = Database.open();
    const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    persistMap(db, [generated]);
    db.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P1', 'plot1', 0, 100)",
    );
    db.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p2', 'P2', 'plot2', 0, 100)",
    );
    const site = loadPlots(db).find((plot) => !plot.worldOwned);
    expect(site).toBeDefined();
    expect(claimPlot(db, "p1", site!.id)).toBe(true);
    expect(claimPlot(db, "p2", site!.id)).toBe(false);
    expect(loadPlots(db).find((plot) => plot.id === site!.id)?.playerId).toBe("p1");
  });
});

describe("starter plots", () => {
  it("provides home, field and storehouse on claim", () => {
    db = Database.open();
    const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
    persistMap(db, [generated]);
    db.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P1', 'plot1', 0, 100)",
    );
    const site = loadPlots(db).find((plot) => !plot.worldOwned)!;
    expect(claimSite(db, "p1", site.id)).toBe(true);
    const buildings = db.all<{ type: string }>(
      "SELECT type FROM buildings WHERE plot_id = ? ORDER BY type",
      site.id,
    );
    expect(buildings.map((building) => building.type)).toEqual(["field", "home", "storehouse"]);
  });
});
