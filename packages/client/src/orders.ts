/**
 * Queued order fetch (M5.A03).
 *
 * Wraps `GET /player/:playerId/orders` so the orders panel can show the current
 * queue before the tick.
 */

export interface QueuedOrder {
  id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  failureReason: string | null;
}

interface OrdersResponse {
  orders?: QueuedOrder[];
}

/** Fetch a player's queued orders. Throws on a non-2xx response. */
export async function fetchOrders(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  signal?: AbortSignal,
): Promise<QueuedOrder[]> {
  const response = await fetch(`${baseUrl}/player/${encodeURIComponent(playerId)}/orders`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /player/${playerId}/orders failed with ${response.status}`);
  }
  const body = (await response.json()) as OrdersResponse;
  return body.orders ?? [];
}
