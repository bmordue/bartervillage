/**
 * Smoke tests for the Preact application shell (M5.A01).
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { App } from "../src/app.js";
import type { MapView } from "../src/map/geometry.js";

const emptyView: MapView = {
  width: 32,
  height: 32,
  background: 0xf4f1e8,
  rects: [],
  outlines: [],
  markers: [],
};

describe("client app shell (M5.A01)", () => {
  const html = render(App({}));

  it("renders a desktop-first layout with header, viewport and sidebar", () => {
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('class="app-header"');
    expect(html).toContain('class="app-main"');
    expect(html).toContain('class="viewport"');
    expect(html).toContain('class="sidebar"');
  });

  it("renders world status fields and the sidebar panels", () => {
    for (const text of [
      "Tick",
      "Season",
      "Weather",
      "Deadline",
      "Orders",
      "Barter board",
      "Inventory",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("uses the supplied page title", () => {
    expect(render(App({ title: "Test Village" }))).toContain("Test Village");
  });

  it("renders world snapshot values when supplied", () => {
    const html = render(
      App({
        world: {
          id: "w1",
          currentTick: 42,
          season: "summer",
          weather: "rain",
          nextDeadline: "2026-11-15T20:00:00.000Z",
        },
      }),
    );
    expect(html).toContain("42");
    expect(html).toContain("summer");
    expect(html).toContain("rain");
    expect(html).toContain("2026-11-15T20:00:00.000Z");
  });

  it("mounts the map canvas when a view is supplied", () => {
    const html = render(App({ mapView: emptyView }));
    expect(html).toContain('class="map-canvas"');
    expect(html).not.toContain("Map and replay render here.");
  });

  it("renders the order, barter and inventory panels from supplied data", () => {
    const html = render(
      App({
        orders: [
          {
            id: "o1",
            sequence: 1,
            type: "plant",
            payload: { item: "wheat" },
            status: "queued",
            failureReason: null,
          },
        ],
        offers: [
          {
            id: "offer1",
            posterId: "p2",
            kind: "offer",
            gives: [{ item: "wheat", quantity: 2 }],
            wants: [{ item: "wood", quantity: 1 }],
            quantity: 1,
            createdAtTick: 3,
            expiryTick: 7,
            status: "open",
            parentOfferId: null,
          },
        ],
        inventory: [{ item: "wheat", quantity: 12, locked: 4, free: 8 }],
      }),
    );

    expect(html).toContain("#1");
    expect(html).toContain("Plant");
    expect(html).toContain("Gives 2 Wheat for 1 Wood");
    expect(html).toContain("Qty 1");
    expect(html).toContain("expires tick 7");
    expect(html).toContain("12");
    expect(html).toContain("4");
    expect(html).toContain("8");
  });

  it("shows empty states when the panels have no data", () => {
    const html = render(App({ orders: [], offers: [], inventory: [] }));

    expect(html).toContain("No orders queued for this tick.");
    expect(html).toContain("No open offers.");
    expect(html).toContain("No stored goods.");
  });

  it("shows energy and ready state for a player", () => {
    const ready = render(
      App({
        player: {
          player: { id: "p1", name: "Ada", plotId: "plot1", energy: 63 },
          ready: { tick: 5, position: 2 },
        },
      }),
    );
    expect(ready).toContain("63");
    expect(ready).toContain("Ready");

    const notReady = render(
      App({
        player: {
          player: { id: "p1", name: "Ada", plotId: "plot1", energy: 7 },
          ready: null,
        },
      }),
    );
    expect(notReady).toContain("7");
    expect(notReady).toContain("Not ready");
  });

  it("renders queue editing controls when handlers are supplied", () => {
    const html = render(
      App({
        orders: [
          {
            id: "o1",
            sequence: 1,
            type: "plant",
            payload: { item: "wheat" },
            status: "queued",
            failureReason: null,
          },
        ],
        onAddOrder: () => undefined,
        onRemoveOrder: () => undefined,
        onReorderOrders: () => undefined,
      }),
    );

    expect(html).toContain("Order type");
    expect(html).toContain("Payload (JSON)");
    expect(html).toContain("Add order");
    expect(html).toContain("Remove");
    expect(html).toContain("Up");
    expect(html).toContain("Down");
  });

  it("keeps the order panel read-only without queue handlers", () => {
    const html = render(
      App({
        orders: [
          {
            id: "o1",
            sequence: 1,
            type: "plant",
            payload: { item: "wheat" },
            status: "queued",
            failureReason: null,
          },
        ],
      }),
    );

    expect(html).not.toContain("Add order");
    expect(html).not.toContain("Remove");
  });
});
