/**
 * Barter board fetch (M5.A03).
 *
 * Wraps `GET /barter` so the barter panel can list open offers, wanted requests
 * and counter-offers.
 */

export interface ItemStack {
  item: string;
  quantity: number;
}

export interface BarterOffer {
  id: string;
  posterId: string;
  kind: string;
  gives: ItemStack[];
  wants: ItemStack[];
  quantity: number;
  createdAtTick: number;
  expiryTick: number;
  status: string;
  parentOfferId: string | null;
}

interface BarterResponse {
  offers?: BarterOffer[];
}

/** Fetch the open posts on the barter board. Throws on a non-2xx response. */
export async function fetchBarter(
  baseUrl = "",
  worldId = "w1",
  signal?: AbortSignal,
): Promise<BarterOffer[]> {
  const response = await fetch(`${baseUrl}/barter`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /barter failed with ${response.status}`);
  }
  const body = (await response.json()) as BarterResponse;
  return body.offers ?? [];
}
