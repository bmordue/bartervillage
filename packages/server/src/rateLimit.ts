/**
 * In-memory fixed-window rate limiter (spec §12; M4.B08).
 *
 * Auth endpoints are limited per client address. The window and clock are
 * injected so tests stay deterministic. State is process-local: the API runs as
 * one process, so a single fixed window per client is enough for v1.
 */

export interface RateLimitOptions {
  /** Requests allowed per client per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export type RateLimitResult =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export const DEFAULT_AUTH_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60_000,
};

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS_BEFORE_SWEEP = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(options: RateLimitOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("Rate limit must be a positive integer");
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) {
      throw new Error("Rate limit window must be positive");
    }
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? (() => Date.now());
  }

  check(key: string): RateLimitResult {
    const now = this.now();
    this.sweepIfNeeded(now);

    const bucket = this.buckets.get(key);
    if (bucket === undefined || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count };
  }

  reset(): void {
    this.buckets.clear();
    this.lastSweep = 0;
  }

  private sweepIfNeeded(now: number): void {
    if (this.buckets.size < MAX_BUCKETS_BEFORE_SWEEP) {
      return;
    }
    if (now - this.lastSweep < this.windowMs) {
      return;
    }
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}
