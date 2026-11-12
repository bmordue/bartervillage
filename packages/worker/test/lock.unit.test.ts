import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tryAcquireLock } from "../src/lock.js";

const directories: string[] = [];

function lockPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "barter-lock-"));
  directories.push(directory);
  return join(directory, "tick.lock");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("global tick lock", () => {
  it("acquires an absent lock and releases it", () => {
    const path = lockPath();
    const lease = tryAcquireLock({ path, owner: "worker-a", now: () => 1000 });

    expect(lease).not.toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      owner: "worker-a",
      acquiredAt: 1000,
      expiresAt: 1000 + 5 * 60_000,
    });

    lease?.release();
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("refuses a lock that another owner still holds", () => {
    const path = lockPath();
    const first = tryAcquireLock({ path, owner: "worker-a", now: () => 1000 });
    const second = tryAcquireLock({ path, owner: "worker-b", now: () => 1001 });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    first?.release();
  });

  it("takes over a lock after its TTL expires", () => {
    const path = lockPath();
    const first = tryAcquireLock({
      path,
      owner: "worker-a",
      now: () => 1000,
      staleAfterMs: 100,
    });
    const second = tryAcquireLock({
      path,
      owner: "worker-b",
      now: () => 1100,
      staleAfterMs: 100,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.owner).toBe("worker-b");
    second?.release();
  });

  it("takes over an unreadable lock once its file is old enough", () => {
    const path = lockPath();
    writeFileSync(path, "not json");
    utimesSync(path, new Date(0), new Date(0));

    const lease = tryAcquireLock({
      path,
      owner: "worker-a",
      now: () => 5_000,
      staleAfterMs: 1_000,
    });

    expect(lease?.owner).toBe("worker-a");
    lease?.release();
  });

  it("does not let a stale lease release a newer lock", () => {
    const path = lockPath();
    const first = tryAcquireLock({
      path,
      owner: "worker-a",
      now: () => 1000,
      staleAfterMs: 100,
    });
    const second = tryAcquireLock({
      path,
      owner: "worker-b",
      now: () => 1100,
      staleAfterMs: 100,
    });

    first?.release();
    expect(tryAcquireLock({ path, owner: "worker-c", now: () => 1101 })).toBeNull();

    second?.release();
    expect(tryAcquireLock({ path, owner: "worker-c", now: () => 1101 })).not.toBeNull();
  });

  it("ignores repeated releases", () => {
    const path = lockPath();
    const lease = tryAcquireLock({ path, owner: "worker-a", now: () => 1000 });

    lease?.release();
    expect(() => lease?.release()).not.toThrow();
  });
});
