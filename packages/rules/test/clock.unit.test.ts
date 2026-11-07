import { describe, expect, it } from "vitest";

import { FixedClock } from "../src/clock.js";

describe("FixedClock", () => {
  it("returns a stable injected instant", () => {
    const clock = new FixedClock("2026-11-07T20:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-11-07T20:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-11-07T20:00:00.000Z");
  });

  it("advances by an explicit duration", () => {
    const clock = new FixedClock(0);
    clock.advance(60_000);
    expect(clock.now().getTime()).toBe(60_000);
  });

  it("can be reset", () => {
    const clock = new FixedClock(0);
    clock.set("2026-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects invalid instants", () => {
    expect(() => new FixedClock("not-a-date")).toThrow();
  });
});
