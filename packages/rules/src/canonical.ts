/**
 * Canonical JSON serialization and state hashing (spec §10, §12, §14).
 *
 * The state hash must be identical on every machine for the same logical state,
 * so objects are serialized with sorted keys and no whitespace. Unsupported
 * values are rejected rather than silently coerced, because a silent difference
 * would make golden logs non-reproducible.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number at ${path}`);
      }
      // Normalize -0 because JSON has no signed zero.
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) {
        throw new CanonicalJsonError(`Circular reference at ${path}`);
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          const parts = value.map((item, index) => {
            if (item === undefined) {
              throw new CanonicalJsonError(`Undefined array item at ${path}[${index}]`);
            }
            return serialize(item, `${path}[${index}]`, seen);
          });
          return `[${parts.join(",")}]`;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .sort();
        const parts = keys.map(
          (key) => `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`, seen)}`,
        );
        return `{${parts.join(",")}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new CanonicalJsonError(`Unsupported value of type ${typeof value} at ${path}`);
  }
}

/** Serialize any JSON-compatible value with object keys sorted recursively. */
export function canonicalize(value: unknown): string {
  return serialize(value, "$", new Set());
}

/** SHA-256 of the canonical form of `value`, as lowercase hex. */
export function hashValue(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalize(value))));
}

/**
 * The state hash recorded with every tick log (spec §10). `nextDeadline` is
 * wall-clock scheduling data and is deliberately excluded by callers before
 * hashing; this helper only hashes what it is given.
 */
export function computeStateHash(state: unknown): string {
  return hashValue(state);
}
