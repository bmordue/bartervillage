import { describe, expect, it } from "vitest";

import { canonicalize, hashValue } from "../src/canonical.js";
import { resolveTick } from "../src/engine.js";
import { createRng, seedFromParts } from "../src/rng.js";
import { FixedClock } from "../src/clock.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";
import { runGoldenScenario } from "./support/golden.js";

describe("determinism", () => {
  it("produces identical events and state hash across repeated runs", () => {
    const state = testWorldState({
      orders: [
        testOrder({ id: "a", sequence: 1 }),
        testOrder({
          id: "b",
          sequence: 2,
          type: "plant",
          payload: { tile: { x: 1, y: 1 }, crop: "wheat" },
        }),
      ],
    });
    const content = testContent();
    const first = resolveTick({ state, content });
    for (let run = 0; run < 50; run += 1) {
      const next = resolveTick({ state, content });
      expect(next.events).toEqual(first.events);
      expect(next.stateHash).toBe(first.stateHash);
    }
  });

  it("does not depend on wall-clock time", () => {
    const clock = new FixedClock("2026-11-07T20:00:00.000Z");
    const state = testWorldState({ orders: [testOrder()] });
    const before = runGoldenScenario(state, testContent(), clock);
    clock.advance(3_600_000);
    expect(runGoldenScenario(state, testContent(), clock).stateHash).toBe(before.stateHash);
  });

  it("derives tick randomness only from the documented seed tuple", () => {
    const a = createRng(seedFromParts(["seed", 5, "gen", "content", "rules"]));
    const b = createRng(seedFromParts(["seed", 5, "gen", "content", "rules"]));
    expect(Array.from({ length: 8 }, () => a.nextUint32())).toEqual(
      Array.from({ length: 8 }, () => b.nextUint32()),
    );
  });

  it("hashes states independently of key insertion order", () => {
    const left = { region: "r1", tick: 5, player: { id: "p1", name: "A" } };
    const right = { player: { name: "A", id: "p1" }, tick: 5, region: "r1" };
    expect(canonicalize(left)).toBe(canonicalize(right));
    expect(hashValue(left)).toBe(hashValue(right));
  });

  it("keeps archived event sequence stable", () => {
    const state = testWorldState({ orders: [testOrder()] });
    const result = resolveTick({ state, content: testContent() });
    expect(result.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(result.events.map((event) => event.tick)).toEqual([5, 5]);
  });
});
