/**
 * Replay viewing on mobile browsers (M5.A07; spec §3).
 *
 * The desktop-first layout may stack on small screens, but replay controls and
 * the event list must stay reachable and scrollable.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("replay mobile layout (M5.A07)", () => {
  it("wraps replay controls and scrolls the event list", () => {
    expect(styles).toMatch(/\.replay-controls\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(styles).toMatch(/\.replay-events-list ul\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("adapts replay controls and list height below the mobile breakpoint", () => {
    const mobile = styles.slice(styles.indexOf("@media (max-width: 640px)"));
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile).toContain(".replay-btn");
    expect(mobile).toContain(".replay-events-list ul");
    expect(mobile).toMatch(/max-height:\s*40vh/);
  });
});
