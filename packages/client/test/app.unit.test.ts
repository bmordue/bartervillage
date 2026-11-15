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
});
