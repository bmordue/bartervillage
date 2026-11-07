import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalize, computeStateHash, hashValue } from "../src/canonical.js";

describe("canonical JSON", () => {
  it("sorts keys recursively", () => {
    const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
    const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalize({ x: -0 })).toBe('{"x":0}');
  });

  it("skips undefined object properties but rejects undefined array items", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalize([undefined])).toThrow(CanonicalJsonError);
  });

  it("rejects non-finite numbers and unsupported types", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalize({ x: Infinity })).toThrow(CanonicalJsonError);
    expect(() => canonicalize({ x: 1n })).toThrow(CanonicalJsonError);
    expect(() => canonicalize({ fn: () => 1 })).toThrow(CanonicalJsonError);
  });

  it("rejects circular references", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => canonicalize(value)).toThrow(CanonicalJsonError);
  });

  it("produces stable sha-256 hashes", () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue(null)).toBe(
      "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    );
    expect(computeStateHash({ tick: 1 })).toBe(hashValue({ tick: 1 }));
  });
});
