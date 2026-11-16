/**
 * Batch order expansion for tile-targeting orders (M5.B03).
 *
 * The client expands a row or area into explicit per-unit order drafts before
 * queueing them. The server still validates every unit independently.
 */

import type { OrderDraft } from "./orders.js";

export type BatchMode = "single" | "row" | "area";

export interface BatchLayout {
  mode: BatchMode;
  count: number;
  width: number;
  height: number;
}

export const MAX_BATCH_ORDERS = 144;

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function tileFrom(payload: Record<string, unknown>): { x: number; y: number } {
  const tile = payload["tile"];
  if (typeof tile !== "object" || tile === null || Array.isArray(tile)) {
    throw new Error("Batch orders need a tile with integer x and y coordinates.");
  }
  const x = (tile as Record<string, unknown>)["x"];
  const y = (tile as Record<string, unknown>)["y"];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    throw new Error("Batch orders need a tile with integer x and y coordinates.");
  }
  return { x, y };
}

/** Expand one tile draft into independent per-unit drafts. */
export function expandTileBatch(draft: OrderDraft, layout: BatchLayout): OrderDraft[] {
  if (layout.mode === "single") {
    return [draft];
  }

  const origin = tileFrom(draft.payload);
  const positions: { x: number; y: number }[] = [];

  if (layout.mode === "row") {
    if (!positiveInteger(layout.count) || layout.count > MAX_BATCH_ORDERS) {
      throw new Error(`Row size must be between 1 and ${MAX_BATCH_ORDERS}.`);
    }
    for (let index = 0; index < layout.count; index += 1) {
      positions.push({ x: origin.x + index, y: origin.y });
    }
  } else {
    if (
      !positiveInteger(layout.width) ||
      !positiveInteger(layout.height) ||
      layout.width * layout.height > MAX_BATCH_ORDERS
    ) {
      throw new Error(`Area size must be between 1 and ${MAX_BATCH_ORDERS} tiles.`);
    }
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) {
        positions.push({ x: origin.x + x, y: origin.y + y });
      }
    }
  }

  return positions.map((tile) => ({
    type: draft.type,
    payload: { ...draft.payload, tile },
  }));
}
