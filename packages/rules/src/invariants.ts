/**
 * Structural invariants from spec §13. Shared by property tests, tick tests and
 * the server's defensive checks after loading state.
 */

import type { WorldState } from "./types.js";

export function checkInvariants(state: WorldState): string[] {
  const problems: string[] = [];

  for (const row of state.inventory) {
    if (row.locked > row.quantity) {
      problems.push(
        `inventory ${row.plotId}/${row.item}: locked ${row.locked} exceeds quantity ${row.quantity}`,
      );
    }
    if (row.quantity < 0 || row.locked < 0) {
      problems.push(`inventory ${row.plotId}/${row.item}: negative quantity or lock`);
    }
  }

  const inventoryKeys = new Set<string>();
  for (const row of state.inventory) {
    const key = `${row.plotId}\u0000${row.item}`;
    if (inventoryKeys.has(key)) {
      problems.push(`inventory ${row.plotId}/${row.item}: duplicate row`);
    }
    inventoryKeys.add(key);
  }

  const plotByPlayer = new Map<string, string>();
  const playerByPlot = new Map<string, string>();
  for (const player of state.players) {
    if (plotByPlayer.has(player.id)) {
      problems.push(`player ${player.id}: owns more than one plot`);
    }
    plotByPlayer.set(player.id, player.plotId);
    if (playerByPlot.has(player.plotId)) {
      problems.push(`plot ${player.plotId}: claimed by more than one player`);
    }
    playerByPlot.set(player.plotId, player.id);
  }

  const readyKeys = new Set<string>();
  const readyPositions = new Set<string>();
  for (const entry of state.ready) {
    const key = `${entry.tick}\u0000${entry.playerId}`;
    if (readyKeys.has(key)) {
      problems.push(`ready ${entry.tick}/${entry.playerId}: duplicate entry`);
    }
    readyKeys.add(key);
    const positionKey = `${entry.tick}\u0000${entry.position}`;
    if (readyPositions.has(positionKey)) {
      problems.push(`ready ${entry.tick}: duplicate position ${entry.position}`);
    }
    readyPositions.add(positionKey);
  }

  for (const node of state.wildNodes) {
    if (node.amount < 0 || node.amount > node.capacity) {
      problems.push(`node ${node.id}: amount ${node.amount} outside 0..${node.capacity}`);
    }
  }

  const claimKeys = new Set<string>();
  for (const claim of state.claims) {
    const key = `${claim.tick}\u0000${claim.playerId}\u0000${claim.nodeId}`;
    if (claimKeys.has(key)) {
      problems.push(`claim ${claim.tick}/${claim.playerId}/${claim.nodeId}: duplicate`);
    }
    claimKeys.add(key);
  }

  const cropsByTile = new Set<string>();
  for (const crop of state.crops) {
    const key = `${crop.plotId}\u0000${crop.tileX}\u0000${crop.tileY}`;
    if (cropsByTile.has(key)) {
      problems.push(`crop tile ${key}: more than one crop`);
    }
    cropsByTile.add(key);
  }

  const offerById = new Map(state.offers.map((offer) => [offer.id, offer]));
  for (const offer of state.offers) {
    for (const stack of [...offer.gives, ...offer.wants]) {
      if (!Number.isInteger(stack.quantity) || stack.quantity <= 0) {
        problems.push(`offer ${offer.id}: non-positive quantity`);
      }
    }
    if (!Number.isInteger(offer.quantity) || offer.quantity <= 0) {
      problems.push(`offer ${offer.id}: quantity must be positive`);
    }
    if (offer.expiryTick < offer.createdAtTick || offer.expiryTick > offer.createdAtTick + 28) {
      problems.push(`offer ${offer.id}: expiry outside 1..28 ticks`);
    }
    if (offer.kind === "wanted_request" && offer.gives.length > 0) {
      problems.push(`offer ${offer.id}: wanted request must not lock goods`);
    }
    if (offer.kind === "counter_offer") {
      if (!offer.parentOfferId) {
        problems.push(`offer ${offer.id}: counter-offer has no parent`);
      } else {
        const parent = offerById.get(offer.parentOfferId);
        if (!parent) {
          problems.push(`offer ${offer.id}: counter-offer parent is missing`);
        } else {
          if (parent.kind === "counter_offer") {
            problems.push(`offer ${offer.id}: counter depth exceeds one`);
          }
          if (offer.status === "open" && parent.status !== "open") {
            problems.push(`offer ${offer.id}: open counter with closed parent ${parent.id}`);
          }
        }
      }
    }
  }

  for (const contribution of state.contributions) {
    if (!Number.isInteger(contribution.items.length)) {
      problems.push(`contribution ${contribution.id}: invalid items`);
    }
  }

  return problems;
}

export function assertInvariants(state: WorldState): void {
  const problems = checkInvariants(state);
  if (problems.length > 0) {
    throw new Error(`State invariants violated:\n${problems.join("\n")}`);
  }
}
