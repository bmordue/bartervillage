import fc from "fast-check";
import { describe, it } from "vitest";

import { createRng } from "../src/rng.js";

describe("seeded RNG properties", () => {
  it("replays identically for any seed", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        return a.nextUint32() === b.nextUint32() && a.nextUint32() === b.nextUint32();
      }),
    );
  });

  it("always stays inside int bounds", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (seed, min, span) => {
          const rng = createRng(seed);
          for (let i = 0; i < 20; i += 1) {
            const value = rng.int(min, min + span);
            if (value < min || value >= min + span) {
              return false;
            }
          }
          return true;
        },
      ),
    );
  });

  it("shuffle preserves the multiset", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.string(), (items, seed) => {
        const shuffled = createRng(seed).shuffle(items);
        return (
          shuffled.length === items.length &&
          [...shuffled].sort((a, b) => a - b).join(",") ===
            [...items].sort((a, b) => a - b).join(",")
        );
      }),
    );
  });
});
