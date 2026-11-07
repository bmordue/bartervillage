import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseContent, validateContent } from "../src/content.js";

const contentPath = fileURLToPath(new URL("../../content/content.json", import.meta.url));
const rawContent = JSON.parse(readFileSync(contentPath, "utf8")) as Record<string, unknown>;

function mutate(mutate: (copy: Record<string, unknown>) => void): Record<string, unknown> {
  const copy = structuredClone(rawContent);
  mutate(copy);
  return copy;
}

describe("content validation", () => {
  it("accepts the shipped v1 content pack", () => {
    const result = validateContent(rawContent);
    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }
    expect(result.content.version).toBe("1.0.0");
    expect(result.content.crops).toHaveLength(15);
    expect(result.content.recipes).toHaveLength(40);
    expect(result.content.buildings).toHaveLength(8);
    expect(result.content.weather).toHaveLength(4);
  });

  it("parses JSON strings", () => {
    const result = parseContent(JSON.stringify(rawContent));
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parseContent("{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("invalid JSON");
    }
  });

  it("rejects unknown season and item references", () => {
    const result = validateContent(
      mutate((copy) => {
        const crops = copy.crops as Array<Record<string, unknown>>;
        crops[0]!.seasons = ["monsoon"];
        crops[0]!.yield = [{ item: "moonstone", quantity: 1 }];
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("unknown season");
      expect(result.errors.join("\n")).toContain("unknown item");
    }
  });

  it("rejects missing weather definitions and duplicate ids", () => {
    const result = validateContent(
      mutate((copy) => {
        copy.weather = (copy.weather as unknown[]).slice(0, 3);
        const crops = copy.crops as Array<Record<string, unknown>>;
        crops.push(structuredClone(crops[0]!));
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("must define exactly the weathers");
      expect(result.errors.join("\n")).toContain("duplicate id");
    }
  });

  it("rejects invalid growth times and non-sequential building levels", () => {
    const result = validateContent(
      mutate((copy) => {
        const crops = copy.crops as Array<Record<string, unknown>>;
        crops[1]!.growthTicks = 9;
        const buildings = copy.buildings as Array<Record<string, unknown>>;
        const levels = buildings[0]!.levels as Array<Record<string, unknown>>;
        levels[1]!.level = 5;
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("must be an integer from 1 to 7");
      expect(result.errors.join("\n")).toContain("levels must be sequential");
    }
  });

  it("rejects recipes that reference unknown buildings or levels", () => {
    const result = validateContent(
      mutate((copy) => {
        const recipes = copy.recipes as Array<Record<string, unknown>>;
        recipes[0]!.building = "castle";
        recipes[1]!.buildingLevel = 99;
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("unknown building");
      expect(result.errors.join("\n")).toContain("exceeds the building's maxLevel");
    }
  });
});
