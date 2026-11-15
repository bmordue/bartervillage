/**
 * Player status fetch and polling (M5.A04).
 *
 * Wraps `GET /player/:playerId` so the status bar can show energy and whether
 * the player has readied for the current tick.
 */

import { createPoller, type Poller, type PollerOptions } from "./polling.js";

export interface PlayerSnapshot {
  id: string;
  name: string;
  plotId: string;
  energy: number;
}

export interface ReadyState {
  tick: number;
  position: number;
}

export interface PlayerStatus {
  player: PlayerSnapshot;
  ready: ReadyState | null;
}

/** Fetch a player's status. Throws on a non-2xx response. */
export async function fetchPlayer(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  signal?: AbortSignal,
): Promise<PlayerStatus> {
  const response = await fetch(`${baseUrl}/player/${encodeURIComponent(playerId)}`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /player/${playerId} failed with ${response.status}`);
  }
  return (await response.json()) as PlayerStatus;
}

export interface PlayerPollerOptions extends Omit<PollerOptions<PlayerStatus>, "fetchData"> {
  baseUrl?: string;
  worldId?: string;
  playerId?: string;
}

export function createPlayerPoller(options: PlayerPollerOptions): Poller {
  return createPoller<PlayerStatus>({
    ...options,
    fetchData: (signal) => fetchPlayer(options.baseUrl, options.worldId, options.playerId, signal),
  });
}
