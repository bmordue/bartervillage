/**
 * Unit tests for the inventory panel detail (M5.B05).
 */

import { describe, expect, it } from "vitest";
import { createElement } from "preact";
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
      createElement(BarterPanel, {
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

describe("barter post flows (M6.02)", () => {
  const inventory = [
    { item: "wheat", quantity: 10, locked: 2, free: 8 },
    { item: "wood", quantity: 4, locked: 0, free: 4 },
  ];

  it("renders an offer form with lock and expiry controls", () => {
    const html = render(createElement(BarterPanel, { inventory, onAddOrder: () => undefined }));

    expect(html).toContain("Post type");
    expect(html).toContain("Give item");
    expect(html).toContain("Want item");
    expect(html).toContain("Expiry (ticks)");
    expect(html).toContain('min="1"');
    expect(html).toContain('max="28"');
    expect(html).toContain("Wheat (8 free)");
    expect(html).toContain("locks when queued");
    expect(html).toContain("8 free");
    expect(html).toContain("Queue offer");
  });

  it("offers a wanted-request post type", () => {
    const html = render(createElement(BarterPanel, { inventory, onAddOrder: () => undefined }));

    expect(html).toContain('<option value="wanted_request">Wanted request</option>');
    expect(html).toContain("Choose an item");
  });

  it("omits the post form without a callback", () => {
    const html = render(createElement(BarterPanel, { inventory }));

    expect(html).not.toContain("Post type");
    expect(html).not.toContain("Queue offer");
  });

  it("shows a cancel-post button for the current player's own open posts", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
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
            posterFreeStock: [{ item: "wheat", free: 3 }],
          },
        ],
        currentPlayerId: "p1",
        onAddOrder: () => undefined,
      }),
    );

    expect(html).toContain("Cancel post");
  });

  it("hides the cancel-post button for posts by other players", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers: [
          {
            id: "o1",
            posterId: "p2",
            posterName: "Bea",
            kind: "offer",
            gives: [{ item: "wheat", quantity: 2 }],
            wants: [{ item: "wood", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [{ item: "wheat", free: 3 }],
          },
        ],
        currentPlayerId: "p1",
        onAddOrder: () => undefined,
      }),
    );

    expect(html).not.toContain("Cancel post");
  });
});

describe("accept offer flow (M6.05)", () => {
  const inventory = [
    { item: "wheat", quantity: 10, locked: 2, free: 8 },
    { item: "wood", quantity: 4, locked: 0, free: 4 },
  ];

  it("shows an accept button for open offers by other players", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers: [
          {
            id: "o1",
            posterId: "p2",
            posterName: "Bea",
            kind: "offer",
            gives: [{ item: "wood", quantity: 2 }],
            wants: [{ item: "wheat", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [{ item: "wood", free: 2 }],
          },
        ],
        currentPlayerId: "p1",
        currentTick: 5,
        onAddOrder: () => undefined,
      }),
    );

    expect(html).toContain("Accept post");
  });

  it("hides the accept button for wanted requests", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers: [
          {
            id: "o1",
            posterId: "p2",
            posterName: "Bea",
            kind: "wanted_request",
            gives: [],
            wants: [{ item: "wheat", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [{ item: "wheat", free: 2 }],
          },
        ],
        currentPlayerId: "p1",
        currentTick: 5,
        onAddOrder: () => undefined,
      }),
    );

    expect(html).not.toContain("Accept post");
  });

  it("hides the accept button for the current player's own posts", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers: [
          {
            id: "o1",
            posterId: "p1",
            posterName: "Ada",
            kind: "offer",
            gives: [{ item: "wood", quantity: 2 }],
            wants: [{ item: "wheat", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [{ item: "wood", free: 2 }],
          },
        ],
        currentPlayerId: "p1",
        currentTick: 5,
        onAddOrder: () => undefined,
      }),
    );

    expect(html).not.toContain("Accept post");
  });

  it("hides the accept button for posts that are not yet acceptable", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers: [
          {
            id: "o1",
            posterId: "p2",
            posterName: "Bea",
            kind: "offer",
            gives: [{ item: "wood", quantity: 2 }],
            wants: [{ item: "wheat", quantity: 1 }],
            quantity: 1,
            createdAtTick: 5,
            expiryTick: 10,
            status: "open",
            parentOfferId: null,
            posterFreeStock: [{ item: "wood", free: 2 }],
          },
        ],
        currentPlayerId: "p1",
        currentTick: 5,
        onAddOrder: () => undefined,
      }),
    );

    expect(html).not.toContain("Accept post");
  });
});

describe("counter-offer flow (M6.03)", () => {
  const inventory = [
    { item: "wheat", quantity: 10, locked: 2, free: 8 },
    { item: "wood", quantity: 4, locked: 0, free: 4 },
  ];
  const offers = [
    {
      id: "o1",
      posterId: "p2",
      posterName: "Bea",
      kind: "offer",
      gives: [{ item: "wood", quantity: 2 }],
      wants: [{ item: "wheat", quantity: 1 }],
      quantity: 1,
      createdAtTick: 3,
      expiryTick: 10,
      status: "open",
      parentOfferId: null,
      posterFreeStock: [{ item: "wood", free: 2 }],
    },
  ];

  it("offers a counter-offer post type and a parent-post picker in counter mode", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers,
        currentPlayerId: "p1",
        onAddOrder: () => undefined,
      }),
    );

    expect(html).toContain('<option value="counter_offer">Counter-offer</option>');
  });

  it("hides the parent-post picker and counter hint until counter mode is chosen", () => {
    const html = render(
      createElement(BarterPanel, {
        inventory,
        offers,
        currentPlayerId: "p1",
        onAddOrder: () => undefined,
      }),
    );

    expect(html).not.toContain("Parent post");
    expect(html).not.toContain("Counters inherit the parent post");
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
