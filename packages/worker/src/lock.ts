/**
 * Global tick lock (spec §14.1; M4.A02).
 *
 * The lock is an OS-level lock file so it is independent of the SQLite
 * resolution transaction. Acquisition is atomic (`O_EXCL`); a lock whose TTL has
 * elapsed can be taken over after a crash. Release only removes the lock if it
 * is still the same lease, so a stale handle cannot steal a newer lock.
 */

import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

export const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

export interface LockRecord {
  owner: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface TryAcquireLockOptions {
  path: string;
  owner: string;
  now?: () => number;
  staleAfterMs?: number;
}

export interface LockLease {
  readonly path: string;
  readonly owner: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  release: () => void;
}

function parseRecord(raw: string): LockRecord | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (
      typeof parsed.owner === "string" &&
      typeof parsed.acquiredAt === "number" &&
      typeof parsed.expiresAt === "number"
    ) {
      return {
        owner: parsed.owner,
        acquiredAt: parsed.acquiredAt,
        expiresAt: parsed.expiresAt,
      };
    }
  } catch {
    // Fall through to the mtime-based staleness check.
  }
  return undefined;
}

function isStale(path: string, now: number, staleAfterMs: number): boolean {
  try {
    const record = parseRecord(readFileSync(path, "utf8"));
    if (record) {
      return now >= record.expiresAt;
    }
    const stats = statSync(path);
    return now - stats.mtimeMs >= staleAfterMs;
  } catch {
    return true;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

export function tryAcquireLock(options: TryAcquireLockOptions): LockLease | null {
  const now = options.now?.() ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const record: LockRecord = {
    owner: options.owner,
    acquiredAt: now,
    expiresAt: now + staleAfterMs,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(options.path, "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify(record));
      } finally {
        closeSync(fd);
      }
      return {
        path: options.path,
        owner: record.owner,
        acquiredAt: record.acquiredAt,
        expiresAt: record.expiresAt,
        release: () => {
          releaseLock(options.path, record);
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error) || attempt === 1) {
        return null;
      }
      if (!isStale(options.path, now, staleAfterMs)) {
        return null;
      }
      try {
        unlinkSync(options.path);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function releaseLock(path: string, record: LockRecord): void {
  try {
    const current = parseRecord(readFileSync(path, "utf8"));
    if (current && current.owner === record.owner && current.acquiredAt === record.acquiredAt) {
      unlinkSync(path);
    }
  } catch {
    // Already released or replaced by another lease.
  }
}
