import { describe, expect, it } from "vitest";

import { content } from "@bartervillage/content";

describe("default content values", () => {
  it("sets the default energy budget and travel cost", () => {
    expect(content.energy.dailyBudget).toBe(100);
    expect(content.energy.travelPerBoundary).toBe(5);
  });

  it("sets the default goodwill awards and badges", () => {
    expect(content.goodwill.gift).toBe(5);
    expect(content.goodwill.help).toBe(1);
    expect(content.goodwill.badges.length).toBeGreaterThan(0);
  });

  it("contains no currency or coin concept (M3.03)", () => {
    const forbidden =
      /\b(currency|coins?|money|cash|gold|silver|dollars?|credits?|wallet|balance|prices?)\b/i;

    expect(JSON.stringify(content)).not.toMatch(forbidden);
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

  it("defines animal types, wild nodes and forage/fishing resources", () => {
    const animalIds = content.animals.map((animal) => animal.id);
    expect(animalIds).toContain("chicken");
    expect(animalIds).toContain("cow");
    expect(animalIds).toContain("sheep");
    expect(animalIds).toContain("pig");
    expect(animalIds).toContain("goat");
    expect(animalIds).toContain("duck");
    expect(animalIds).toContain("rabbit");

    const wildNodeIds = content.wildNodes.map((node) => node.id);
    expect(wildNodeIds).toContain("berry_bush");
    expect(wildNodeIds).toContain("river_fish");
    expect(wildNodeIds).toContain("wood_grove");

    for (const animal of content.animals) {
      expect(content.items[animal.feedItem]).toBeDefined();
    }
  });
});
