/**
 * Light client-side validation for queued orders (M4.B04, M5.B07).
 *
 * The client only catches obvious input mistakes and an energy shortfall from
 * the last poll. The server remains authoritative for all business rules
 * (energy, capacity, locks, location and offer state), so a stale client can
 * never let an invalid order through.
 */

import type { OrderDraft } from "./orders.js";

export interface OrderDraftValidation {
  /** Energy from the most recent player snapshot, when known. */
  availableEnergy?: number;
  /** Content-defined energy cost for this order type, when known. */
  energyCost?: number;
}

/**
 * Lightweight validation performed on the client before sending an order to the server.
 *
 * This check is non-authoritative; all substantive rules (energy, capacity,
 * location, locks, offer state) are enforced server-side. The energy check uses
 * the last polled snapshot and is only a convenience.
 */
export function validateOrderDraft(draft: OrderDraft, options: OrderDraftValidation = {}): void {
  if (!draft.type || typeof draft.type !== "string") {
    throw new Error("Order type must be a non‑empty string.");
  }

  // Basic payload shape validation; each order type expects its own payload
  // structure. For now we ensure the payload is a non‑empty object (or at least
  // a plain object) to avoid common user errors.
  if (!draft.payload || typeof draft.payload !== "object" || Array.isArray(draft.payload)) {
    throw new Error("Order payload must be a JSON object.");
  }

  // Energy is a light check only: the server re-reads the authoritative budget.
  if (
    options.availableEnergy !== undefined &&
    options.energyCost !== undefined &&
    options.energyCost > options.availableEnergy
  ) {
    throw new Error(
      `Not enough energy for this order (needs ${options.energyCost}, have ${options.availableEnergy}).`,
    );
  }

  // Help orders target a host plot and a chore; the tile is optional because a
  // chore applies to the host's whole plot (M6.09).
  if (draft.type === "help") {
    const targetPlotId = draft.payload["targetPlotId"];
    if (typeof targetPlotId !== "string" || targetPlotId.length === 0) {
      throw new Error("Help orders require a 'targetPlotId' string.");
    }
    const chore = draft.payload["chore"];
    if (chore !== "water" && chore !== "tend" && chore !== "feed") {
      throw new Error("Help orders require a chore of water, tend or feed.");
    }
    return;
  }

  // Simple heuristic to catch missing tile coordinates for tile‑targeting orders.
  // This does not replace server‑side validation of coordinates or ownership.
  const tile = draft.payload["tile"];
  if (
    draft.type === "plant" ||
    draft.type === "tend" ||
    draft.type === "harvest" ||
    draft.type === "forage"
  ) {
    if (typeof tile !== "object" || tile === null || Array.isArray(tile)) {
      throw new Error("Tile orders require a 'tile' object with integer x and y coordinates.");
    }
    const x = (tile as Record<string, unknown>)["x"];
    const y = (tile as Record<string, unknown>)["y"];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isInteger(x) ||
      !Number.isInteger(y)
    ) {
      throw new Error("Tile coordinates must be integers.");
    }
  }
}
