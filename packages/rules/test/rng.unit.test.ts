import { describe, expect, it } from "vitest";

import { createRng, hashSeed, seedFromParts } from "../src/rng.js";

describe("seeded RNG", () => {
  it("produces the same stream for the same seed", () => {
    const a = createRng("world-1");
    const b = createRng("world-1");
    const left = Array.from({ length: 16 }, () => a.nextUint32());
    const right = Array.from({ length: 16 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });

  it("produces different streams for different seeds", () => {
    const a = createRng("world-1");
    const b = createRng("world-2");
    const left = Array.from({ length: 16 }, () => a.nextUint32());
    const right = Array.from({ length: 16 }, () => b.nextUint32());
    expect(left).not.toEqual(right);
  });

  it("honours integer bounds and never returns the exclusive maximum", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
    }
  });

  it("supports numeric and tuple seeds unambiguously", () => {
    expect(seedFromParts(["1", 2])).not.toBe(seedFromParts(["12"]));
    expect(createRng(42).nextUint32()).toBe(createRng(42).nextUint32());
  });

  it("forks independent streams deterministically", () => {
    const left = createRng("root").fork("map").nextUint32();
    const right = createRng("root").fork("map").nextUint32();
    expect(left).toBe(right);
  });

  it("hashes seeds to unsigned 32-bit values", () => {
    const hash = hashSeed("barter");
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 32);
  });
});
