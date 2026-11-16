/**
 * Plot snapshot fetch (M5.B01).
 *
 * Wraps `GET /plot/:plotId` so the plot view can show the home, field,
 * storehouse, crops, animals and storage capacity.
 */

import type { InventoryItem } from "./inventory.js";

export interface PlotSummary {
  id: string;
  playerId: string | null;
  regionId: string;
  siteX: number;
  siteY: number;
  width: number;
  height: number;
  worldOwned: boolean;
}

export interface PlotBuilding {
  id: string;
  plotId: string;
  type: string;
  level: number;
  constructionKind: string | null;
  constructionCompleteTick: number | null;
}

export interface PlotCrop {
  id: string;
  plotId: string;
  tileX: number;
  tileY: number;
  type: string;
  plantedTick: number;
  growthTicks: number;
  watered: boolean;
  tended: boolean;
  failed: boolean;
}

export interface PlotAnimal {
  id: string;
  plotId: string;
  type: string;
  count: number;
  fed: boolean;
}

export interface StorageSummary {
  capacity: number;
  used: number;
  free: number;
}

export interface PlotSnapshot {
  plot: PlotSummary;
  buildings: PlotBuilding[];
  crops: PlotCrop[];
  animals: PlotAnimal[];
  storage: StorageSummary;
  inventory: InventoryItem[];
  ready: { tick: number; position: number } | null;
}

interface PlotResponse {
  plot?: PlotSummary;
  buildings?: PlotBuilding[];
  crops?: PlotCrop[];
  animals?: PlotAnimal[];
  storage?: StorageSummary;
  inventory?: InventoryItem[];
  ready?: { tick: number; position: number } | null;
}

/** Fetch a plot snapshot. Throws on a non-2xx response. */
export async function fetchPlot(
  baseUrl = "",
  worldId = "w1",
  plotId = "plot1",
  signal?: AbortSignal,
): Promise<PlotSnapshot> {
  const response = await fetch(`${baseUrl}/plot/${encodeURIComponent(plotId)}`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /plot/${plotId} failed with ${response.status}`);
  }
  const body = (await response.json()) as PlotResponse;
  if (!body.plot) {
    throw new Error("GET /plot/:plotId returned no plot");
  }
  const inventory = body.inventory ?? [];
  return {
    plot: body.plot,
    buildings: body.buildings ?? [],
    crops: body.crops ?? [],
    animals: body.animals ?? [],
    storage: body.storage ?? {
      capacity: 0,
      used: inventory.reduce((total, item) => total + item.quantity, 0),
      free: 0,
    },
    inventory,
    ready: body.ready ?? null,
  };
}
