/**
 * World snapshot fetch and polling (spec §12; M5.A05).
 *
 * Wraps `GET /world` in a five-second poller. Later client tasks consume the
 * snapshot for the status bar (M5.A04) and the map (M5.A02).
 */

import { createPoller, type Poller, type PollerOptions } from "./polling.js";

export interface WorldSnapshot {
  id: string;
  currentTick: number;
  season: string;
  weather: string;
  nextDeadline: string;
}

interface WorldResponse {
  world?: WorldSnapshot;
}

/** Fetch the current world snapshot. Throws on a non-2xx response. */
export async function fetchWorld(
  baseUrl = "",
  worldId = "w1",
  signal?: AbortSignal,
): Promise<WorldSnapshot> {
  const response = await fetch(`${baseUrl}/world`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /world failed with ${response.status}`);
  }
  const body = (await response.json()) as WorldResponse;
  if (!body.world) {
    throw new Error("GET /world returned no world");
  }
  return body.world;
}

export interface WorldPollerOptions extends Omit<PollerOptions<WorldSnapshot>, "fetchData"> {
  baseUrl?: string;
  worldId?: string;
}

export function createWorldPoller(options: WorldPollerOptions): Poller {
  return createPoller<WorldSnapshot>({
    ...options,
    fetchData: (signal) => fetchWorld(options.baseUrl, options.worldId, signal),
  });
}
