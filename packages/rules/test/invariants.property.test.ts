import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { checkInvariants } from "../src/invariants.js";
import { testWorldState } from "./fixtures.js";
import {
  invariantStateArb,
  invariantsHold,
  plotsForPlayers,
  playersArb,
} from "./support/property.js";

describe("invariant property harness", () => {
  it("holds for generated internally consistent states", () => {
    fc.assert(fc.property(invariantStateArb(), (state) => invariantsHold(state)));
  });

  it("detects locked stock exceeding held stock", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "wheat", quantity: 1, locked: 2 }],
    });
    expect(checkInvariants(state)[0]).toContain("locked 2 exceeds quantity 1");
  });

  it("detects duplicate inventory rows for one plot and item", () => {
    const state = testWorldState({
      inventory: [
        { plotId: "plot1", item: "wheat", quantity: 1, locked: 0 },
        { plotId: "plot1", item: "wheat", quantity: 2, locked: 0 },
      ],
    });
    expect(checkInvariants(state).join("\n")).toContain("duplicate row");
  });

  it("detects duplicate ready positions within a tick", () => {
    const state = testWorldState({
      ready: [
        { playerId: "p1", tick: 5, position: 0 },
        { playerId: "p2", tick: 5, position: 0 },
      ],
    });
    expect(checkInvariants(state).join("\n")).toContain("duplicate position");
  });

  it("keeps one player per plot and one plot per player", () => {
    fc.assert(
      fc.property(playersArb(), (players) => {
        const state = testWorldState({ players, plots: plotsForPlayers(players) });
        return invariantsHold(state);
      }),
    );
  });

  it("rejects an open counter-offer whose parent is not open", () => {
    const state = testWorldState({
      offers: [
        {
          id: "offer:parent",
          posterId: "p1",
          kind: "offer",
          gives: [{ item: "wheat", quantity: 1 }],
          wants: [{ item: "wood", quantity: 1 }],
          quantity: 1,
          createdAtTick: 5,
          expiryTick: 12,
          status: "cancelled",
          parentOfferId: null,
        },
        {
          id: "offer:counter",
          posterId: "p2",
          kind: "counter_offer",
          gives: [{ item: "wood", quantity: 1 }],
          wants: [{ item: "wheat", quantity: 1 }],
          quantity: 1,
          createdAtTick: 5,
          expiryTick: 12,
          status: "open",
          parentOfferId: "offer:parent",
        },
      ],
    });

    expect(checkInvariants(state).join("\n")).toContain("open counter with closed parent");
  });

  it("allows a cancelled counter-offer whose parent has closed", () => {
    const state = testWorldState({
      offers: [
        {
          id: "offer:parent",
          posterId: "p1",
          kind: "offer",
          gives: [{ item: "wheat", quantity: 1 }],
          wants: [{ item: "wood", quantity: 1 }],
          quantity: 1,
          createdAtTick: 5,
          expiryTick: 12,
          status: "cancelled",
          parentOfferId: null,
        },
        {
          id: "offer:counter",
          posterId: "p2",
          kind: "counter_offer",
          gives: [{ item: "wood", quantity: 1 }],
          wants: [{ item: "wheat", quantity: 1 }],
          quantity: 1,
          createdAtTick: 5,
          expiryTick: 12,
          status: "cancelled",
          parentOfferId: "offer:parent",
        },
      ],
    });

    expect(checkInvariants(state)).toEqual([]);
  });
});
