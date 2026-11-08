import fc from "fast-check";

import { checkInvariants } from "../../src/invariants.js";
import type { InventoryRow, Offer, Plot, Player, WildNode, WorldState } from "../../src/types.js";
import { testWorldState } from "../fixtures.js";

export const inventoryRowArb: fc.Arbitrary<InventoryRow> = fc
  .record({
    plotId: fc.constantFrom("plot1", "plot2"),
    item: fc.constantFrom("wheat", "wood", "stone"),
    quantity: fc.integer({ min: 0, max: 1000 }),
  })
  .chain((base) =>
    fc.integer({ min: 0, max: base.quantity }).map((locked) => ({ ...base, locked })),
  );

export const wildNodeArb: fc.Arbitrary<WildNode> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    regionId: fc.constantFrom("r1", "r2"),
    x: fc.integer({ min: 0, max: 11 }),
    y: fc.integer({ min: 0, max: 11 }),
    resource: fc.constantFrom("wood", "stone", "fish"),
    capacity: fc.integer({ min: 1, max: 100 }),
  })
  .chain((base) =>
    fc
      .integer({ min: 0, max: base.capacity })
      .map((amount) => ({ ...base, amount, regrowRate: 1 })),
  );

export const offerArb: fc.Arbitrary<Offer> = fc
  .record({
    id: fc.uuid(),
    posterId: fc.constantFrom("p1", "p2"),
    kind: fc.constantFrom<Offer["kind"]>("offer", "wanted_request"),
    quantity: fc.integer({ min: 1, max: 10 }),
    createdAtTick: fc.integer({ min: 0, max: 100 }),
  })
  .chain((base) =>
    fc
      .record({
        expiryOffset: fc.integer({ min: 1, max: 28 }),
        gives: fc.array(
          fc.record({ item: fc.constant("wheat"), quantity: fc.integer({ min: 1, max: 10 }) }),
          { maxLength: 2 },
        ),
      })
      .map((extra) => ({
        ...base,
        expiryTick: base.createdAtTick + extra.expiryOffset,
        status: "open" as const,
        parentOfferId: null,
        gives: base.kind === "wanted_request" ? [] : extra.gives,
        wants: [],
      })),
  );

export function invariantStateArb(): fc.Arbitrary<WorldState> {
  return fc
    .record({
      inventory: fc.array(inventoryRowArb),
      wildNodes: fc.array(wildNodeArb),
      offers: fc.array(offerArb),
    })
    .map(({ inventory, wildNodes, offers }) =>
      testWorldState({
        inventory: dedupeInventory(inventory),
        wildNodes: dedupeById(wildNodes),
        offers: dedupeById(offers),
      }),
    );
}

function dedupeInventory(rows: InventoryRow[]): InventoryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.plotId}\u0000${row.item}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/** Use inside fc.property: fails the property when any invariant is violated. */
export function invariantsHold(state: WorldState): boolean {
  return checkInvariants(state).length === 0;
}

export function playersArb(): fc.Arbitrary<Player[]> {
  return fc
    .uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 0, maxLength: 20 })
    .map((ids) =>
      ids.map((id) => ({
        id: `p${id}`,
        name: `Player ${id}`,
        plotId: `plot${id}`,
        joinedTick: 0,
        energy: 100,
        defaults: { harvest: true, water: true, feed: true, tend: false },
      })),
    );
}

export function plotsForPlayers(players: Player[]): Plot[] {
  return players.map((player) => ({
    id: player.plotId,
    playerId: player.id,
    regionId: "r1",
    siteX: 0,
    siteY: 0,
    width: 12,
    height: 12,
    worldOwned: false,
  }));
}
