/**
 * Replay avatar paths on the map (spec §5, §10; M5.C02).
 *
 * Rebuilds the regions referenced by the latest replay and overlays each
 * avatar's complete route, including the return home. Kept free of Preact and
 * PixiJS so the path geometry can be unit-tested in Node.
 */

import { content } from "@bartervillage/content";
import {
  generateRegion,
  type ArchivedEvent,
  type AvatarPath,
  type AvatarPathPoint,
  type Region,
} from "@bartervillage/rules";

import type { TickReplayResponse } from "../replay.js";
import {
  buildMapView,
  regionCenter,
  type MapLocation,
  type MapMarker,
  type MapPath,
  type MapView,
  type Point,
} from "./geometry.js";

const PLAYER_COLORS = [0xd64545, 0x3a7bd5, 0x4f7a3a, 0xc07a1f, 0x8a4fbf, 0x1f8a8a];

function colorForPlayer(playerId: string): number {
  let hash = 0;
  for (const character of playerId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return PLAYER_COLORS[hash % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? 0x333333;
}

function readAvatarPath(event: ArchivedEvent): AvatarPath | undefined {
  if (event.type !== "avatar_path") {
    return undefined;
  }
  const payload = event.payload as { path?: AvatarPath };
  if (!payload.path || !Array.isArray(payload.path.via)) {
    return undefined;
  }
  return payload.path;
}

/** Extract complete avatar paths from the replay event log. */
export function avatarPathsFromReplay(replay: TickReplayResponse): AvatarPath[] {
  const paths: AvatarPath[] = [];
  for (const event of replay.events) {
    const path = readAvatarPath(event);
    if (path) {
      paths.push(path);
    }
  }
  return paths;
}

/** Region grid coordinates encoded in a generated region id. */
export function parseRegionId(id: string): { x: number; y: number } | undefined {
  const match = /^region:(-?\d+):(-?\d+)$/.exec(id);
  if (!match) {
    return undefined;
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : undefined;
}

function routePoints(path: AvatarPath): AvatarPathPoint[] {
  return [path.from, ...path.via, path.to];
}

function pointOnMap(region: Region | undefined): Point | undefined {
  if (!region) {
    return undefined;
  }
  return regionCenter(region);
}

function uniqueRegions(paths: readonly AvatarPath[]): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();
  for (const path of paths) {
    for (const point of routePoints(path)) {
      const parsed = parseRegionId(point.regionId);
      if (parsed) {
        coords.set(point.regionId, parsed);
      }
    }
  }
  if (coords.size === 0) {
    coords.set("region:0:0", { x: 0, y: 0 });
  }
  return coords;
}

/**
 * Build a map view containing every region an avatar visited in the replay,
 * plus the complete route lines and an avatar marker at each route end.
 */
export function buildReplayMapView(replay: TickReplayResponse): MapView {
  const avatarPaths = avatarPathsFromReplay(replay);
  const coords = [...uniqueRegions(avatarPaths).entries()]
    .map(([id, coord]) => ({ id, ...coord }))
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const generated = coords.map((coord) =>
    generateRegion(
      replay.header.worldSeed,
      replay.header.generatorVersion,
      coord.x,
      coord.y,
      content,
    ),
  );
  const regions = generated.map((region) => region.region);
  const regionsById = new Map(regions.map((region) => [region.id, region]));

  const paths: MapPath[] = [];
  const markers: MapMarker[] = [];
  for (const path of avatarPaths) {
    const color = colorForPlayer(path.playerId);
    const points = routePoints(path)
      .map((point) => pointOnMap(regionsById.get(point.regionId)))
      .filter((point): point is Point => point !== undefined);
    if (points.length >= 2) {
      paths.push({ playerId: path.playerId, points, color, width: 3 });
    }
    const end = points.at(-1);
    if (end) {
      markers.push({ x: end.x, y: end.y, radius: 7, color });
    }
  }

  return buildMapView(
    {
      regions,
      tiles: generated.flatMap((region) => region.tiles),
      plots: generated.flatMap((region) => region.plots),
      wildNodes: generated.flatMap((region) => region.wildNodes),
    },
    { extraPaths: paths, extraMarkers: markers },
  );
}

/** Camera rectangle for following one location in the replay viewer. */
export function focusForLocation(
  locations: readonly MapLocation[],
  id: string | null,
): MapView["focus"] {
  if (!id) {
    return undefined;
  }
  const location = locations.find((candidate) => candidate.id === id);
  if (!location) {
    return undefined;
  }
  return {
    x: location.x,
    y: location.y,
    width: location.width,
    height: location.height,
    color: 0x000000,
  };
}
