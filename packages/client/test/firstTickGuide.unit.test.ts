/**
 * Guided first tick (M8.11; spec §11).
 */

import { describe, expect, it } from "vitest";
import { createElement } from "preact";
import { render } from "preact-render-to-string";

import { firstTickGuide } from "../src/firstTickGuide.js";
import { FirstTickPanel } from "../src/firstTickPanel.js";

describe("guided first tick (M8.11)", () => {
  it("points a brand-new player at their plot", () => {
    const guide = firstTickGuide({
      currentTick: 1,
      hasPlot: false,
      orderCount: 0,
      ready: false,
      replayTick: undefined,
    });
    expect(guide.visible).toBe(true);
    expect(guide.complete).toBe(false);
    expect(guide.next?.id).toBe("plot");
    expect(guide.steps.map((step) => step.done)).toEqual([false, false, false, false]);
  });

  it("advances through orders, ready and the replay", () => {
    const guide = firstTickGuide({
      currentTick: 1,
      hasPlot: true,
      orderCount: 2,
      ready: true,
      replayTick: undefined,
    });
    expect(guide.next?.id).toBe("replay");
    expect(guide.steps.filter((step) => step.done)).toHaveLength(3);
  });

  it("hides the guide once the world has moved past the first tick", () => {
    expect(
      firstTickGuide({
        currentTick: 2,
        hasPlot: true,
        orderCount: 0,
        ready: false,
        replayTick: undefined,
      }).visible,
    ).toBe(false);
  });

  it("renders the checklist and the next hint", () => {
    const html = render(
      createElement(FirstTickPanel, {
        currentTick: 1,
        hasPlot: true,
        orderCount: 0,
        ready: false,
        replayTick: undefined,
      }),
    );
    expect(html).toContain("Your first tick");
    expect(html).toContain("Review your plot");
    expect(html).toContain("Queue your first orders");
    expect(html).toContain("Add at least one order");
    expect(html).toContain("Dismiss guide");
  });
});
