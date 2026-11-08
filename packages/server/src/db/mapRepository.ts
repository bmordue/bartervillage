/**
 * Explicit map persistence (spec §5; M3.07).
 *
 * Rows are inserted once and never rewritten, so existing plots cannot move and
 * existing regions cannot regenerate.
 */

import type { Plot, Region, Tile, WildNode } from "@bartervillage/rules";
import type { RegionGeneration } from "@bartervillage/rules";
import type { Database } from "./database.js";

type RegionRow = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TileRow = {
  id: string;
  region_id: string;
  x: number;
  y: number;
  type: Tile["type"];
  biome: string;
  soil: number;
  water: number;
  light: number;
};

type PlotRow = {
  id: string;
  player_id: string | null;
  region_id: string;
  site_x: number;
  site_y: number;
  width: number;
  height: number;
  world_owned: number;
};

type NodeRow = {
  id: string;
  region_id: string;
  x: number;
  y: number;
  resource: string;
  amount: number;
  capacity: number;
  regrow_rate: number;
};

export function persistRegion(db: Database, generated: RegionGeneration): void {
  db.run(
    "INSERT INTO regions (id, x, y, width, height) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    generated.region.id,
    generated.region.x,
    generated.region.y,
    generated.region.width,
    generated.region.height,
  );

  for (const tile of generated.tiles) {
    db.run(
      `INSERT INTO tiles (id, region_id, x, y, type, biome, soil, water, light)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      tile.id,
      tile.regionId,
      tile.x,
      tile.y,
      tile.type,
      tile.biome,
      tile.traits.soil,
      tile.traits.water,
      tile.traits.light,
    );
  }

  for (const plot of generated.plots) {
    db.run(
      `INSERT INTO plots (id, player_id, region_id, site_x, site_y, width, height, world_owned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      plot.id,
      plot.playerId,
      plot.regionId,
      plot.siteX,
      plot.siteY,
      plot.width,
      plot.height,
      plot.worldOwned ? 1 : 0,
    );
  }

  for (const node of generated.wildNodes) {
    db.run(
      `INSERT INTO wild_nodes (id, region_id, x, y, resource, amount, capacity, regrow_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      node.id,
      node.regionId,
      node.x,
      node.y,
      node.resource,
      node.amount,
      node.capacity,
      node.regrowRate,
    );
  }
}

/** First-write-wins site claim (spec §5; M3.09). */
export function claimPlot(db: Database, playerId: string, plotId: string): boolean {
  const result = db.run(
    "UPDATE plots SET player_id = ? WHERE id = ? AND player_id IS NULL AND world_owned = 0",
    playerId,
    plotId,
  );
  return Number(result.changes) === 1;
}

export function persistMap(db: Database, regions: readonly RegionGeneration[]): void {
  db.transaction(() => {
    for (const region of regions) {
      persistRegion(db, region);
    }
  });
}

export function loadRegions(db: Database): Region[] {
  return db
    .all<RegionRow>("SELECT id, x, y, width, height FROM regions ORDER BY x, y")
    .map((row) => ({ ...row }));
}

export function loadTiles(db: Database): Tile[] {
  return db
    .all<TileRow>(
      "SELECT id, region_id, x, y, type, biome, soil, water, light FROM tiles ORDER BY region_id, y, x",
    )
    .map((row) => ({
      id: row.id,
      regionId: row.region_id,
      x: row.x,
      y: row.y,
      type: row.type,
      biome: row.biome,
      traits: { soil: row.soil, water: row.water, light: row.light },
    }));
}

export function loadPlots(db: Database): Plot[] {
  return db
    .all<PlotRow>(
      "SELECT id, player_id, region_id, site_x, site_y, width, height, world_owned FROM plots ORDER BY region_id, site_y, site_x",
    )
    .map((row) => ({
      id: row.id,
      playerId: row.player_id,
      regionId: row.region_id,
      siteX: row.site_x,
      siteY: row.site_y,
      width: row.width,
      height: row.height,
      worldOwned: row.world_owned !== 0,
    }));
}

export function loadWildNodes(db: Database): WildNode[] {
  return db
    .all<NodeRow>(
      "SELECT id, region_id, x, y, resource, amount, capacity, regrow_rate FROM wild_nodes ORDER BY region_id, id",
    )
    .map((row) => ({
      id: row.id,
      regionId: row.region_id,
      x: row.x,
      y: row.y,
      resource: row.resource,
      amount: row.amount,
      capacity: row.capacity,
      regrowRate: row.regrow_rate,
    }));
}
