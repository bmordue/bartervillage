import { describe, expect, it } from "vitest";

import { nextDeadlineFor } from "../src/deadline.js";

describe("nextDeadlineFor", () => {
  it("uses the next local occurrence strictly after the resolution", () => {
    expect(
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "20:00",
        minTickGapMinutes: 60,
        now: new Date("2026-11-07T10:00:00.000Z"),
      }),
    ).toBe("2026-11-07T20:00:00.000Z");

    expect(
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "20:00",
        minTickGapMinutes: 60,
        now: new Date("2026-11-07T20:00:00.000Z"),
      }),
    ).toBe("2026-11-08T20:00:00.000Z");
  });

  it("enforces the minimum gap even when the deadline is near", () => {
    expect(
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "20:00",
        minTickGapMinutes: 60,
        now: new Date("2026-11-07T19:30:00.000Z"),
      }),
    ).toBe("2026-11-08T20:00:00.000Z");
  });

  it("converts from an IANA timezone to a UTC instant", () => {
    expect(
      nextDeadlineFor({
        timezone: "America/New_York",
        deadlineTime: "20:00",
        minTickGapMinutes: 60,
        now: new Date("2026-11-07T10:00:00.000Z"),
      }),
    ).toBe("2026-11-08T01:00:00.000Z");
  });

  it("defaults the gap to sixty minutes", () => {
    expect(
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "20:00",
        now: new Date("2026-11-07T19:30:00.000Z"),
      }),
    ).toBe("2026-11-08T20:00:00.000Z");
  });

  it("rejects invalid deadlines, gaps and timezones", () => {
    expect(() =>
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "25:00",
        now: new Date(),
      }),
    ).toThrow("Invalid deadline time");
    expect(() =>
      nextDeadlineFor({
        timezone: "UTC",
        deadlineTime: "20:00",
        minTickGapMinutes: -1,
        now: new Date(),
      }),
    ).toThrow("Invalid minimum tick gap");
    expect(() =>
      nextDeadlineFor({
        timezone: "Not/AZone",
        deadlineTime: "20:00",
        now: new Date(),
      }),
    ).toThrow("Invalid timezone");
  });
});
