import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalize, hashValue } from "../src/canonical.js";

const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.array(tie("value")),
    fc.dictionary(fc.string(), tie("value")),
  ),
})).value;

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reorder);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, item]) => [key, reorder(item)]));
  }
  return value;
}

describe("canonical JSON properties", () => {
  it("is independent of insertion order", () => {
    fc.assert(
      fc.property(jsonValue, (value) => canonicalize(value) === canonicalize(reorder(value))),
    );
  });

  it("round-trips through JSON without changing the canonical form", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = canonicalize(value);
        const reparsed = JSON.parse(once) as unknown;
        return canonicalize(reparsed) === once;
      }),
    );
  });

  it("hash is stable for equivalent values", () => {
    fc.assert(fc.property(jsonValue, (value) => hashValue(value) === hashValue(reorder(value))));
  });
});
