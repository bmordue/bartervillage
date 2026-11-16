/**
 * Player status fetch and polling (M5.A04).
 *
 * Wraps `GET /player/:playerId` so the status bar can show energy and whether
 * the player has readied for the current tick.
 */

import { TickInProgressError } from "./orders.js";
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

/** Ready or unready the player for the current tick. Throws on a non-2xx response. */
export async function setReady(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  ready = true,
  signal?: AbortSignal,
): Promise<ReadyState | null> {
  const response = await fetch(`${baseUrl}/player/${encodeURIComponent(playerId)}/ready`, {
    method: "PUT",
    headers: {
      "x-world-id": worldId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ready }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 409) {
      throw new TickInProgressError();
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error) {
      throw new Error(body.error);
    }
    throw new Error(`PUT /player/${playerId}/ready failed with ${response.status}`);
  }
  const body = (await response.json()) as { ready?: ReadyState | null };
  return body.ready ?? null;
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
