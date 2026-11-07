import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("property runner", () => {
  it("runs fast-check generators", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
    );
  });
});
