/**
 * Villager list fetch (M5.A08).
 *
 * Wraps `GET /players` so the plot view can offer a read-only look at other
 * players' plots.
 */

export interface PlayerSummary {
  id: string;
  name: string;
  plotId: string;
  energy: number;
}

interface PlayersResponse {
  players?: PlayerSummary[];
}

/** Fetch every player in the world. Throws on a non-2xx response. */
export async function fetchPlayers(
  baseUrl = "",
  worldId = "w1",
  signal?: AbortSignal,
): Promise<PlayerSummary[]> {
  const response = await fetch(`${baseUrl}/players`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /players failed with ${response.status}`);
  }
  const body = (await response.json()) as PlayersResponse;
  return body.players ?? [];
}
