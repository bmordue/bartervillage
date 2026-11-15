/**
 * Map geometry and placeholder art (spec §5, §11; M5.A02).
 *
 * Pure helpers that turn world tiles into pixel rectangles for the PixiJS
 * renderer. Kept free of PixiJS so they can be unit-tested in Node. Colours stand
 * in for the final 32x32 art packs until M8.10 lands.
 */

import type { BiomeId, Plot, Region, Tile, TileType, WildNode } from "@bartervillage/rules";

export const TILE_SIZE = 32;

export interface Point {
  x: number;
  y: number;
}

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

export interface MapOutline {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  strokeWidth: number;
}

export interface MapMarker {
  x: number;
  y: number;
  radius: number;
  color: number;
}

export interface MapView {
  width: number;
  height: number;
  background: number;
  rects: MapRect[];
  outlines: MapOutline[];
  markers: MapMarker[];
}

/** Pixel origin of a region on the world canvas. */
export function regionOrigin(region: Region): Point {
  return { x: region.x * region.width * TILE_SIZE, y: region.y * region.height * TILE_SIZE };
}

/** Pixel origin of a tile, relative to the world canvas. */
export function tileOrigin(region: Region, tile: { x: number; y: number }): Point {
  const origin = regionOrigin(region);
  return {
    x: origin.x + tile.x * TILE_SIZE,
    y: origin.y + tile.y * TILE_SIZE,
  };
}

const TILE_COLORS: Record<TileType, number> = {
  plot: 0x9ec97a,
  commons: 0xcbbf95,
  wild: 0x6f9e58,
  water: 0x4e8fbf,
  blocked: 0x5f5b55,
};

const BIOME_TINTS: Record<BiomeId, number> = {
  meadow: 0x000000,
  forest_edge: 0x0a1a06,
  riverside: 0x061a2a,
  coast: 0x0a2233,
  hills: 0x1a1206,
};

/** Placeholder tile colour: base type colour with a small biome tint. */
export function tileColor(type: TileType, biome: BiomeId): number {
  const base = TILE_COLORS[type];
  const tint = BIOME_TINTS[biome] ?? 0;
  return blend(base, tint, 0.35);
}

function blend(a: number, b: number, amount: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * amount);
  const g = Math.round(ag + (bg - ag) * amount);
  const blue = Math.round(ab + (bb - ab) * amount);
  return (r << 16) | (g << 8) | blue;
}

export interface MapSource {
  regions: readonly Region[];
  tiles: readonly Tile[];
  plots?: readonly Plot[];
  wildNodes?: readonly WildNode[];
}

export interface BuildMapViewOptions {
  background?: number;
  includePlots?: boolean;
  includeWildNodes?: boolean;
  /** Replay overlays (e.g. avatar positions) drawn on top of the map. */
  extraMarkers?: readonly MapMarker[];
}

/**
 * Build the draw list for a world map. Regions are laid out on a grid; each tile
 * becomes one 32x32 rectangle. Plot boundaries and wild nodes are overlaid so the
 * map reads without final art.
 */
export function buildMapView(source: MapSource, options: BuildMapViewOptions = {}): MapView {
  const regionsById = new Map(source.regions.map((region) => [region.id, region]));

  let width = 0;
  let height = 0;
  for (const region of source.regions) {
    const origin = regionOrigin(region);
    width = Math.max(width, origin.x + region.width * TILE_SIZE);
    height = Math.max(height, origin.y + region.height * TILE_SIZE);
  }

  const rects: MapRect[] = [];
  for (const tile of source.tiles) {
    const region = regionsById.get(tile.regionId);
    if (!region) {
      continue;
    }
    const origin = tileOrigin(region, tile);
    rects.push({
      x: origin.x,
      y: origin.y,
      width: TILE_SIZE,
      height: TILE_SIZE,
      color: tileColor(tile.type, tile.biome),
    });
  }

  const outlines: MapOutline[] = [];
  if (options.includePlots ?? true) {
    for (const plot of source.plots ?? []) {
      const region = regionsById.get(plot.regionId);
      if (!region) {
        continue;
      }
      const origin = regionOrigin(region);
      outlines.push({
        x: origin.x + plot.siteX * TILE_SIZE,
        y: origin.y + plot.siteY * TILE_SIZE,
        width: plot.width * TILE_SIZE,
        height: plot.height * TILE_SIZE,
        color: plot.worldOwned ? 0x8a7b55 : 0x2f5d22,
        strokeWidth: 2,
      });
    }
  }

  const markers: MapMarker[] = [];
  if (options.includeWildNodes ?? true) {
    for (const node of source.wildNodes ?? []) {
      const region = regionsById.get(node.regionId);
      if (!region) {
        continue;
      }
      const origin = regionOrigin(region);
      markers.push({
        x: origin.x + (node.x + 0.5) * TILE_SIZE,
        y: origin.y + (node.y + 0.5) * TILE_SIZE,
        radius: 6,
        color: node.amount > 0 ? 0x8a5a2b : 0x6b6b6b,
      });
    }
  }

  if (options.extraMarkers) {
    markers.push(...options.extraMarkers);
  }

  return {
    width: width || TILE_SIZE,
    height: height || TILE_SIZE,
    background: options.background ?? 0xf4f1e8,
    rects,
    outlines,
    markers,
  };
}
