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
});
