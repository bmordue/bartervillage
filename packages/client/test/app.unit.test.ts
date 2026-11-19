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
  paths: [],
  locations: [],
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

  it("renders the plot view with the home, field and storehouse", () => {
    const html = render(
      App({
        mapView: emptyView,
        plot: {
          plot: {
            id: "plot1",
            playerId: "p1",
            regionId: "r1",
            siteX: 2,
            siteY: 3,
            width: 4,
            height: 4,
            worldOwned: false,
          },
          buildings: [
            {
              id: "b1",
              plotId: "plot1",
              type: "home",
              level: 2,
              constructionKind: null,
              constructionCompleteTick: null,
            },
            {
              id: "b2",
              plotId: "plot1",
              type: "field",
              level: 1,
              constructionKind: null,
              constructionCompleteTick: null,
            },
            {
              id: "b3",
              plotId: "plot1",
              type: "storehouse",
              level: 1,
              constructionKind: null,
              constructionCompleteTick: null,
            },
          ],
          crops: [
            {
              id: "c1",
              plotId: "plot1",
              tileX: 0,
              tileY: 0,
              type: "wheat",
              plantedTick: 1,
              growthTicks: 2,
              watered: true,
              tended: true,
              failed: false,
            },
          ],
          animals: [],
          storage: { capacity: 40, used: 10, free: 30 },
          inventory: [{ item: "wheat", quantity: 10, locked: 3, free: 7 }],
          ready: null,
        },
      }),
    );

    expect(html).toContain("Your plot");
    expect(html).toContain("Home");
    expect(html).toContain("Field");
    expect(html).toContain("Storehouse");
    expect(html).toContain("10 / 40 used");
    expect(html).toContain("Wheat");
    expect(html).toContain("Plot");
  });

  it("shows a friendly tick-in-progress notice", () => {
    const html = render(
      App({
        notice: "A tick is resolving. Your change was not applied; try again in a moment.",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("A tick is resolving");
  });

  it("lists other villagers and renders a read-only plot", () => {
    const html = render(
      App({
        players: [
          { id: "p1", name: "Ada", plotId: "plot1", energy: 90 },
          { id: "p2", name: "Bea", plotId: "plot2", energy: 80 },
        ],
        currentPlayerId: "p1",
        viewedPlot: {
          plot: {
            id: "plot2",
            playerId: "p2",
            regionId: "r1",
            siteX: 4,
            siteY: 5,
            width: 2,
            height: 2,
            worldOwned: false,
          },
          buildings: [
            {
              id: "b1",
              plotId: "plot2",
              type: "home",
              level: 1,
              constructionKind: null,
              constructionCompleteTick: null,
            },
          ],
          crops: [],
          animals: [],
          storage: { capacity: 100, used: 0, free: 100 },
          inventory: [],
          ready: null,
        },
        onViewPlot: () => undefined,
        onCloseViewedPlot: () => undefined,
      }),
    );

    expect(html).toContain("Bea");
    expect(html).not.toContain("Ada</span>");
    expect(html).toContain("View Bea's plot");
    expect(html).toContain("Viewing plot2 (read-only)");
    expect(html).toContain("Read-only");
    expect(html).toContain("Back to my plot");
  });

  it("offers a ready toggle and explains queue locking", () => {
    const notReady = render(
      App({
        player: {
          player: { id: "p1", name: "Ada", plotId: "plot1", energy: 90 },
          ready: null,
        },
        onToggleReady: () => undefined,
      }),
    );
    const ready = render(
      App({
        player: {
          player: { id: "p1", name: "Ada", plotId: "plot1", energy: 90 },
          ready: { tick: 3, position: 2 },
        },
        onToggleReady: () => undefined,
      }),
    );

    expect(notReady).toContain("Ready for tick");
    expect(notReady).toContain("Not ready");
    expect(notReady).toContain("The queue is fixed once the tick starts.");
    expect(notReady).toContain(">Ready</button>");
    expect(ready).toContain("Ready at position 2. Cancel to edit your queue.");
    expect(ready).toContain("Cancel ready");
  });

  it("shows the latest resolved order failures", () => {
    const html = render(
      App({
        orderFailures: [
          {
            id: "o1",
            sequence: 2,
            type: "plant",
            payload: {},
            status: "failed",
            failureReason: "Not enough energy",
          },
        ],
        failureTick: 4,
      }),
    );

    expect(html).toContain("Failed in tick 4");
    expect(html).toContain("Not enough energy");
  });

  it("offers help chores on another player's plot", () => {
    const html = render(
      App({
        player: {
          player: { id: "p1", name: "Ada", plotId: "plot1", energy: 90 },
          ready: null,
        },
        viewedPlot: {
          plot: {
            id: "plot2",
            playerId: "p2",
            regionId: "r1",
            siteX: 4,
            siteY: 5,
            width: 2,
            height: 2,
            worldOwned: false,
          },
          buildings: [],
          crops: [
            {
              id: "c1",
              plotId: "plot2",
              tileX: 0,
              tileY: 0,
              type: "wheat",
              plantedTick: 1,
              growthTicks: 2,
              watered: false,
              tended: false,
              failed: false,
            },
          ],
          animals: [{ id: "a1", plotId: "plot2", type: "chicken", count: 1, fed: false }],
          storage: { capacity: 100, used: 0, free: 100 },
          inventory: [],
          ready: null,
        },
        onHelp: () => undefined,
      }),
    );

    expect(html).toContain("Help out");
    expect(html).toContain('data-chore="water"');
    expect(html).toContain('data-chore="tend"');
    expect(html).toContain('data-chore="feed"');
    expect(html).toContain("+1");
    expect(html).toContain("Water crops");
  });

  it("offers follow-location controls when a replay spans several regions", () => {
    const html = render(
      App({
        mapView: {
          ...emptyView,
          locations: [
            { id: "region:0:0", name: "Region 0, 0", x: 0, y: 0, width: 32, height: 32 },
            { id: "region:1:0", name: "Region 1, 0", x: 32, y: 0, width: 32, height: 32 },
          ],
        },
        replay: {
          tick: 1,
          header: {
            v: 1,
            tick: 1,
            worldSeed: "seed",
            generatorVersion: "1",
            contentVersion: "1.0.0",
            rulesVersion: "1.0.0",
          },
          events: [],
        },
      }),
    );

    expect(html).toContain("Follow location");
    expect(html).toContain("All locations");
    expect(html).toContain("Region 1, 0");
    expect(html).toContain("Schema v1");
    expect(html).toContain("Seed seed");
  });
});
