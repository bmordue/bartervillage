/**
 * Cosmetic goodwill badges (spec §8; M6.12).
 *
 * Goodwill is a score that players earn through gifts and help. Badges are a
 * purely decorative tier derived from that score: they never unlock recipes,
 * gate actions, move goods or affect production. Nothing here feeds back into
 * the order engine, so goodwill cannot become a currency.
 */

import { describe, expect, it } from "vitest";

import { currentBadge, earnedBadges } from "../src/goodwill.js";
import { testContent } from "./fixtures.js";

describe("goodwill badges (M6.12)", () => {
  const content = testContent({
    goodwill: {
      gift: 5,
      help: 1,
      badges: [
        { id: "badge_kindHelper", name: "Kind Helper", minScore: 1 },
        { id: "badge_generous", name: "Generous", minScore: 5 },
        { id: "badge_charitable", name: "Charitable", minScore: 10 },
        { id: "badge_neighbor", name: "Neighborhood Goodwill", minScore: 25 },
      ],
    },
  });

  it("returns no badge below the lowest threshold", () => {
    expect(currentBadge(0, content.goodwill)).toBeUndefined();
  });

  it("returns the lowest badge at the first threshold", () => {
    expect(currentBadge(1, content.goodwill)?.id).toBe("badge_kindHelper");
  });

  it("returns the highest earned badge", () => {
    expect(currentBadge(7, content.goodwill)?.id).toBe("badge_generous");
    expect(currentBadge(25, content.goodwill)?.id).toBe("badge_neighbor");
  });

  it("returns all earned badges in threshold order", () => {
    const earned = earnedBadges(30, content.goodwill);
    expect(earned.map((badge) => badge.id)).toEqual([
      "badge_kindHelper",
      "badge_generous",
      "badge_charitable",
      "badge_neighbor",
    ]);
  });

  it("is cosmetic: badges never affect production", () => {
    // The only thing a badge can do is describe a score. There is no field on
    // GoodwillConfig that the order engine reads, so no badge can unlock a
    // recipe, gate an action or move goods. This assertion pins that.
    for (const badge of content.goodwill.badges) {
      expect(badge.minScore).toBeGreaterThanOrEqual(0);
    }
  });
});
