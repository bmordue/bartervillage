/**
 * Version identities (spec §10, §14.3, M1.07).
 *
 * Rules, content and generator versions are pinned per tick and seeded into the
 * RNG. Changing any of them intentionally invalidates golden logs.
 */

import type { Tick, TickHeader, VersionSet } from "./types.js";

/** Bumped whenever gameplay rules change. */
export const RULES_VERSION = "1.0.0";
/** Schema version of the replay/tick log envelope. */
export const TICK_SCHEMA_VERSION = 1 as const;

export class VersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export interface TickHeaderInput extends VersionSet {
  worldSeed: string | number;
  tick: Tick;
}

export function makeTickHeader(input: TickHeaderInput): TickHeader {
  if (!input.generatorVersion) {
    throw new VersionMismatchError("generatorVersion is required");
  }
  if (!input.contentVersion) {
    throw new VersionMismatchError("contentVersion is required");
  }
  if (!input.rulesVersion) {
    throw new VersionMismatchError("rulesVersion is required");
  }
  if (!Number.isInteger(input.tick) || input.tick < 0) {
    throw new VersionMismatchError(`Invalid tick number: ${input.tick}`);
  }
  return {
    v: TICK_SCHEMA_VERSION,
    worldSeed: String(input.worldSeed),
    tick: input.tick,
    generatorVersion: input.generatorVersion,
    contentVersion: input.contentVersion,
    rulesVersion: input.rulesVersion,
  };
}

/** The RNG seed tuple fixed by spec §14.3. */
export function tickSeedParts(header: TickHeader): (string | number)[] {
  return [
    header.worldSeed,
    header.tick,
    header.generatorVersion,
    header.contentVersion,
    header.rulesVersion,
  ];
}

export function assertCompatibleVersions(pinned: VersionSet, current: VersionSet): void {
  if (pinned.rulesVersion !== current.rulesVersion) {
    throw new VersionMismatchError(
      `Rules version mismatch: pinned ${pinned.rulesVersion}, current ${current.rulesVersion}`,
    );
  }
  if (pinned.contentVersion !== current.contentVersion) {
    throw new VersionMismatchError(
      `Content version mismatch: pinned ${pinned.contentVersion}, current ${current.contentVersion}`,
    );
  }
  if (pinned.generatorVersion !== current.generatorVersion) {
    throw new VersionMismatchError(
      `Generator version mismatch: pinned ${pinned.generatorVersion}, current ${current.generatorVersion}`,
    );
  }
}
