/**
 * Deterministic map generation (spec §5; M3.06, M3.11, M3.12).
 *
 * The same world seed and generator version always produce the same region.
 * Regions are generated independently so appending one never changes another.
 */

import { createRng } from "./rng.js";
import type {
  BiomeId,
  ContentPack,
  NodeId,
  Plot,
  PlotId,
  Region,
  RegionId,
  Tile,
  TileId,
  WildNode,
  WorldState,
} from "./types.js";

export const MAP_GENERATOR_VERSION = "1";
export const REGION_BLOCKS = 4;
export const BLOCK_SIZE = 12;
export const REGION_WIDTH = REGION_BLOCKS * BLOCK_SIZE;
export const REGION_HEIGHT = REGION_WIDTH;
export const PLOT_SIZE = BLOCK_SIZE;
export const PLOTS_PER_REGION = 4;
export const COMMONS_PER_REGION = 4;

const PLOT_BLOCKS: readonly (readonly [number, number])[] = [
  [0, 0],
  [3, 0],
  [0, 3],
  [3, 3],
];

const COMMONS_BLOCKS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
];

export interface RegionGeneration {
  region: Region;
  tiles: Tile[];
  plots: Plot[];
  wildNodes: WildNode[];
}

export function regionId(x: number, y: number): RegionId {
  return `region:${x}:${y}`;
}

function tileId(region: RegionId, x: number, y: number): TileId {
  return `${region}:tile:${x}:${y}`;
}

function plotId(region: RegionId, blockX: number, blockY: number): PlotId {
  return `${region}:plot:${blockX}:${blockY}`;
}

function nodeId(region: RegionId, index: number): NodeId {
  return `${region}:node:${index}`;
}

function isPlotBlock(bx: number, by: number): boolean {
  return PLOT_BLOCKS.some(([x, y]) => x === bx && y === by);
}

function isCommonsBlock(bx: number, by: number): boolean {
  return COMMONS_BLOCKS.some(([x, y]) => x === bx && y === by);
}

function pickBiome(rng: ReturnType<typeof createRng>, content: ContentPack): BiomeId {
  const biomes = content.biomes;
  if (biomes.length === 0) {
    return "meadow";
  }
  return rng.pick(biomes).id;
}

function traitsFor(
  content: ContentPack,
  biome: BiomeId,
): { soil: number; water: number; light: number } {
  const definition = content.biomes.find((entry) => entry.id === biome);
  return definition ? { ...definition.traits } : { soil: 5, water: 5, light: 5 };
}

/**
 * Generate one region. `x` and `y` are region-grid coordinates; the generator
 * version is part of every seed so upgrading it cannot silently move plots.
 */
export function generateRegion(
  worldSeed: string,
  generatorVersion: string,
  x: number,
  y: number,
  content: ContentPack,
  config: { width: number; height: number } = { width: REGION_WIDTH, height: REGION_HEIGHT },
): RegionGeneration {
  const region = regionId(x, y);
  const rng = createRng([worldSeed, generatorVersion, "region", x, y]);
  const regionBiome = pickBiome(rng, content);
  const regionTraits = traitsFor(content, regionBiome);
  const tiles: Tile[] = [];
  const plots: Plot[] = [];
  const blocksX = Math.max(1, Math.floor(config.width / BLOCK_SIZE));
  const blocksY = Math.max(1, Math.floor(config.height / BLOCK_SIZE));

  const waterBlocks = new Set<string>();
  if (regionBiome === "riverside" || regionBiome === "coast") {
    const rows = regionBiome === "coast" ? [blocksY - 2, blocksY - 1] : [Math.floor(blocksY / 2)];
    for (const by of rows) {
      for (let bx = 0; bx < blocksX; bx += 1) {
        if (!isPlotBlock(bx, by) && !isCommonsBlock(bx, by)) {
          waterBlocks.add(`${bx}:${by}`);
        }
      }
    }
  }

  for (let ty = 0; ty < config.height; ty += 1) {
    for (let tx = 0; tx < config.width; tx += 1) {
      const bx = Math.floor(tx / BLOCK_SIZE);
      const by = Math.floor(ty / BLOCK_SIZE);
      const inPlot = isPlotBlock(bx, by);
      const inCommons = isCommonsBlock(bx, by);
      const tileType = inPlot
        ? "plot"
        : inCommons
          ? "commons"
          : waterBlocks.has(`${bx}:${by}`)
            ? "water"
            : "wild";
      const biome = inPlot ? pickBiome(rng, content) : regionBiome;
      const traits = inPlot ? traitsFor(content, biome) : regionTraits;
      tiles.push({
        id: tileId(region, tx, ty),
        regionId: region,
        x: tx,
        y: ty,
        type: tileType,
        biome,
        traits: { ...traits },
      });
    }
  }

  PLOT_BLOCKS.forEach(([bx, by]) => {
    if (bx >= blocksX || by >= blocksY) {
      return;
    }
    plots.push({
      id: plotId(region, bx, by),
      playerId: null,
      regionId: region,
      siteX: bx * BLOCK_SIZE,
      siteY: by * BLOCK_SIZE,
      width: PLOT_SIZE,
      height: PLOT_SIZE,
      worldOwned: false,
    });
  });

  COMMONS_BLOCKS.forEach(([bx, by]) => {
    if (bx >= blocksX || by >= blocksY) {
      return;
    }
    plots.push({
      id: plotId(region, bx, by),
      playerId: null,
      regionId: region,
      siteX: bx * BLOCK_SIZE,
      siteY: by * BLOCK_SIZE,
      width: BLOCK_SIZE,
      height: BLOCK_SIZE,
      worldOwned: true,
    });
  });

  const wildNodes: WildNode[] = [];
  const candidates = plots
    .filter((plot) => plot.worldOwned)
    .flatMap((plot) =>
      tiles.filter(
        (tile) =>
          tile.regionId === region &&
          tile.x >= plot.siteX &&
          tile.x < plot.siteX + plot.width &&
          tile.y >= plot.siteY &&
          tile.y < plot.siteY + plot.height,
      ),
    );
  const waterTiles = tiles.filter((tile) => tile.type === "water");
  const definitions = [...content.wildNodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const used = new Set<string>();
  definitions.forEach((definition, index) => {
    const pool = definition.resource === "fish" ? waterTiles : candidates;
    const available = pool.filter((tile) => !used.has(tile.id));
    if (available.length === 0) {
      return;
    }
    const tile = rng.pick(available);
    used.add(tile.id);
    wildNodes.push({
      id: nodeId(region, index),
      regionId: region,
      x: tile.x,
      y: tile.y,
      resource: definition.resource,
      amount: definition.capacity,
      capacity: definition.capacity,
      regrowRate: definition.regrowRate,
    });
  });

  return {
    region: { id: region, x, y, width: config.width, height: config.height },
    tiles,
    plots,
    wildNodes,
  };
}

/** Append the next region in deterministic order (spec §5; M3.08). */
export function appendRegion(
  state: WorldState,
  content: ContentPack,
  generatorVersion = MAP_GENERATOR_VERSION,
): RegionGeneration {
  const nextIndex = state.regions.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nextIndex + 1)));
  const x = nextIndex % columns;
  const y = Math.floor(nextIndex / columns);
  const generated = generateRegion(state.world.config.seed, generatorVersion, x, y, content);
  state.regions.push(generated.region);
  state.tiles.push(...generated.tiles);
  state.plots.push(...generated.plots);
  state.wildNodes.push(...generated.wildNodes);
  return generated;
}
