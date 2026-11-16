/**
 * Unit tests for the inventory panel detail (M5.B05).
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { BarterPanel, InventoryPanel, OrderFailuresPanel } from "../src/panels.js";

describe("inventory panel (M5.B05)", () => {
  it("shows held, locked, free and capacity", () => {
    const html = render(
      InventoryPanel({
        items: [
          { item: "wheat", quantity: 10, locked: 3, free: 7 },
          { item: "wood", quantity: 4, locked: 0, free: 4 },
        ],
        storage: { capacity: 100, used: 14, free: 86 },
      }),
    );

    expect(html).toContain("14 / 100 capacity");
    expect(html).toContain("86 free");
    expect(html).toContain("Wheat");
    expect(html).toContain("Wood");
    expect(html).toContain("Total");
    expect(html).toContain("<td>14</td>");
    expect(html).toContain("<td>3</td>");
    expect(html).toContain("<td>11</td>");
  });

  it("shows capacity even before any goods are stored", () => {
    const html = render(
      InventoryPanel({ items: [], storage: { capacity: 100, used: 0, free: 100 } }),
    );

    expect(html).toContain("0 / 100 capacity");
    expect(html).toContain("No stored goods.");
  });

  it("omits the capacity bar without a storage summary", () => {
    const html = render(InventoryPanel({ items: [] }));

    expect(html).not.toContain("capacity");
  });
});

describe("barter panel (M6.01)", () => {
  it("lists posts with poster names, free stock and counter links", () => {
    const html = render(
      BarterPanel({
        offers: [
          {
            id: "o1",
            posterId: "p1",
            posterName: "Ada",
            kind: "offer",
            gives: [{ item: "wheat", quantity: 2 }],
            wants: [{ item: "wood", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [
              { item: "wheat", free: 3 },
              { item: "wood", free: 4 },
            ],
          },
          {
            id: "o2",
            posterId: "p2",
            posterName: "Bea",
            kind: "counter_offer",
            gives: [{ item: "stone", quantity: 1 }],
            wants: [{ item: "wheat", quantity: 2 }],
            quantity: 1,
            createdAtTick: 4,
            expiryTick: 10,
            status: "open",
            parentOfferId: "o1",
            posterFreeStock: [],
          },
        ],
      }),
    );

    expect(html).toContain("Ada");
    expect(html).toContain("Bea");
    expect(html).toContain("Counter-offer");
    expect(html).toContain("Poster free stock: 3 Wheat, 4 Wood");
    expect(html).toContain("counters o1");
  });
});

describe("order failures panel (M5.B06)", () => {
  it("shows failure reasons for the latest resolved tick", () => {
    const html = render(
      OrderFailuresPanel({
        failures: [
          {
            id: "o1",
            sequence: 1,
            type: "harvest",
            payload: {},
            status: "failed",
            failureReason: "Crop has failed",
          },
          {
            id: "o2",
            sequence: 2,
            type: "feed",
            payload: {},
            status: "failed",
            failureReason: null,
          },
        ],
        failureTick: 7,
      }),
    );

    expect(html).toContain("Failed in tick 7");
    expect(html).toContain("Crop has failed");
    expect(html).toContain("Order failed");
  });

  it("hides the failure section when nothing failed", () => {
    expect(render(OrderFailuresPanel({ failures: [], failureTick: null }))).toBe("");
  });
});
