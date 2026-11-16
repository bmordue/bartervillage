/**
 * Plot inventory fetch (M5.A03).
 *
 * Wraps `GET /plot/:plotId` so the inventory panel can show held, locked and
 * free stock.
 */

export interface InventoryItem {
  item: string;
  quantity: number;
  locked: number;
  free: number;
}

interface PlotResponse {
  inventory?: InventoryItem[];
}

/** Fetch a plot's inventory rows. Throws on a non-2xx response. */
export async function fetchInventory(
  baseUrl = "",
  worldId = "w1",
  plotId = "plot1",
  signal?: AbortSignal,
): Promise<InventoryItem[]> {
  const response = await fetch(`${baseUrl}/plot/${encodeURIComponent(plotId)}`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /plot/${plotId} failed with ${response.status}`);
  }
  const body = (await response.json()) as PlotResponse;
  return body.inventory ?? [];
}
