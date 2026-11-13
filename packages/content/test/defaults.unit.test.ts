import { describe, expect, it } from "vitest";

import { content } from "@bartervillage/content";

describe("default content values", () => {
  it("sets the default energy budget and travel cost", () => {
    expect(content.energy.dailyBudget).toBe(100);
    expect(content.energy.travelPerBoundary).toBe(5);
  });

  it("sets the default goodwill awards", () => {
    expect(content.goodwill).toEqual({ gift: 5, help: 1 });
  });

  it("defines the weather modifiers", () => {
    const weather = new Map(content.weather.map((entry) => [entry.id, entry]));

    expect(weather.get("clear")?.countsAsWatering).toBe(false);
    expect(weather.get("rain")?.countsAsWatering).toBe(true);
    expect(weather.get("drought")?.failureChance).toBeGreaterThan(0);
    expect(weather.get("frost")?.frostDamage).toBe(true);
  });

  it("defines a goal schedule with unique goals and positive durations", () => {
    expect(content.goals.length).toBeGreaterThanOrEqual(4);

    const ids = content.goals.map((goal) => goal.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const goal of content.goals) {
      expect(goal.durationTicks).toBeGreaterThan(0);
      expect(goal.rewards.length).toBeGreaterThan(0);
    }
  });
});
