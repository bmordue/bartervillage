import { afterEach, describe, expect, it } from "vitest";

import { buildApiRoutes } from "../src/api.js";
import { DEFAULT_AUTH_RATE_LIMIT, RateLimiter } from "../src/rateLimit.js";
import { startTestApi, type TestApi } from "./support/harness.js";

describe("RateLimiter", () => {
  it("allows requests up to the limit and reports the remainder", () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => 1000 });

    expect(limiter.check("client-a")).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check("client-a")).toEqual({ allowed: true, remaining: 0 });
  });

  it("rejects requests over the limit until the window resets", () => {
    let now = 1000;
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000, now: () => now });

    expect(limiter.check("client-a")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check("client-a")).toEqual({ allowed: false, retryAfterSeconds: 60 });

    now += 30_000;
    expect(limiter.check("client-a")).toEqual({ allowed: false, retryAfterSeconds: 30 });

    now += 30_000;
    expect(limiter.check("client-a")).toEqual({ allowed: true, remaining: 0 });
  });

  it("keeps separate windows per client key", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => 1000 });

    expect(limiter.check("client-a")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check("client-a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.check("client-b")).toEqual({ allowed: true, remaining: 0 });
  });

  it("rejects invalid configuration", () => {
    expect(() => new RateLimiter({ limit: 0, windowMs: 1000 })).toThrow(/positive integer/);
    expect(() => new RateLimiter({ limit: 1, windowMs: 0 })).toThrow(/window/);
  });
});

describe("auth endpoint rate limiting", () => {
  let harness: TestApi | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it("returns 429 per client and leaves non-auth routes unlimited", async () => {
    harness = await startTestApi({
      buildRoutes: (database) =>
        buildApiRoutes(database, { authRateLimit: { limit: 2, windowMs: 60_000 } }),
    });
    const baseUrl = harness.baseUrl;

    const first = await fetch(`${baseUrl}/auth/credentials`, {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const second = await fetch(`${baseUrl}/auth/credentials`, {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const third = await fetch(`${baseUrl}/auth/credentials`, {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await third.json()).toMatchObject({ error: "rate_limited" });

    const otherClient = await fetch(`${baseUrl}/auth/credentials`, {
      headers: { "x-forwarded-for": "203.0.113.2" },
    });
    expect(otherClient.status).toBe(401);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const world = await fetch(`${baseUrl}/world`, {
        headers: { "x-forwarded-for": "203.0.113.1" },
      });
      expect(world.status).toBe(404);
    }
  });

  it("uses a permissive default limit", () => {
    expect(DEFAULT_AUTH_RATE_LIMIT.limit).toBeGreaterThan(10);
    expect(DEFAULT_AUTH_RATE_LIMIT.windowMs).toBe(60_000);
  });
});
