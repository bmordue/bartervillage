/**
 * Queued order fetch and queue editing (M5.A03, M5.B02).
 *
 * Wraps `GET /player/:playerId/orders` so the orders panel can show the current
 * queue before the tick, plus the add, remove and reorder endpoints the queue UI
 * uses.
 */

export interface QueuedOrder {
  id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  failureReason: string | null;
}

export interface OrderDraft {
  type: string;
  payload: Record<string, unknown>;
}

export interface OrderFailures {
  tick: number | null;
  failures: QueuedOrder[];
}

interface OrdersResponse {
  orders?: QueuedOrder[];
}

interface AddOrderResponse {
  order?: { id: string; sequence: number };
}

/** True when the API rejected a mutation because a tick is resolving. */
export class TickInProgressError extends Error {
  constructor() {
    super("A tick is resolving. Your change was not applied; try again in a moment.");
    this.name = "TickInProgressError";
  }
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  if (response.status === 409) {
    return new TickInProgressError();
  }
  const text = await response.text().catch(() => "");
  if (text.length > 0) {
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) {
        return new Error(body.error);
      }
    } catch {
      return new Error(text);
    }
  }
  return new Error(`${fallback} with ${response.status}`);
}

function requestInit(
  method: string,
  worldId: string,
  body?: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: {
      "x-world-id": worldId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  };
}

/** Fetch a player's queued orders. Throws on a non-2xx response. */
export async function fetchOrders(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  signal?: AbortSignal,
): Promise<QueuedOrder[]> {
  const response = await fetch(
    `${baseUrl}/player/${encodeURIComponent(playerId)}/orders`,
    requestInit("GET", worldId, undefined, signal),
  );
  if (!response.ok) {
    throw await apiError(response, `GET /player/${playerId}/orders failed`);
  }
  const body = (await response.json()) as OrdersResponse;
  return body.orders ?? [];
}

/** Fetch the failed orders from the most recently resolved tick. */
export async function fetchOrderFailures(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  signal?: AbortSignal,
): Promise<OrderFailures> {
  const response = await fetch(
    `${baseUrl}/player/${encodeURIComponent(playerId)}/order-failures`,
    requestInit("GET", worldId, undefined, signal),
  );
  if (!response.ok) {
    throw await apiError(response, `GET /player/${playerId}/order-failures failed`);
  }
  return (await response.json()) as OrderFailures;
}

/** Queue one order. Throws on a non-2xx response. */
export async function addOrder(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  draft: OrderDraft,
  signal?: AbortSignal,
): Promise<{ id: string; sequence: number }> {
  const response = await fetch(
    `${baseUrl}/player/${encodeURIComponent(playerId)}/orders`,
    requestInit("POST", worldId, draft, signal),
  );
  if (!response.ok) {
    throw await apiError(response, `POST /player/${playerId}/orders failed`);
  }
  const body = (await response.json()) as AddOrderResponse;
  if (!body.order) {
    throw new Error("POST /player/:playerId/orders returned no order");
  }
  return body.order;
}

/** Remove one queued order. Throws on a non-2xx response. */
export async function removeOrder(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  orderId = "",
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/player/${encodeURIComponent(playerId)}/orders/${encodeURIComponent(orderId)}`,
    requestInit("DELETE", worldId, undefined, signal),
  );
  if (!response.ok) {
    throw await apiError(response, `DELETE /player/${playerId}/orders/${orderId} failed`);
  }
}

/** Replace the sequence of every queued order. Throws on a non-2xx response. */
export async function reorderOrders(
  baseUrl = "",
  worldId = "w1",
  playerId = "p1",
  orderIds: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/player/${encodeURIComponent(playerId)}/orders`,
    requestInit("PUT", worldId, { orderIds }, signal),
  );
  if (!response.ok) {
    throw await apiError(response, `PUT /player/${playerId}/orders failed`);
  }
}

/** Move one id within a list without mutating the input. */
export function moveOrder(orderIds: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= orderIds.length || to < 0 || to >= orderIds.length) {
    return [...orderIds];
  }
  const next = [...orderIds];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) {
    next.splice(to, 0, moved);
  }
  return next;
}
