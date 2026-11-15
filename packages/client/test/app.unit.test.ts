/**
 * Smoke tests for the Preact application shell (M5.A01).
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { App } from "../src/app.js";

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
});
