import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { type FixedClock } from "../../src/clock.js";
import { resolveTick } from "../../src/engine.js";
import type { ContentPack, GameEvent, TickHeader, WorldState } from "../../src/types.js";
import { TEST_CLOCK } from "./harness.js";

const goldenDir = fileURLToPath(new URL("../golden/expected/", import.meta.url));

export interface GoldenLog {
  scheduledAt: string;
  header: TickHeader;
  events: GameEvent[];
  stateHash: string;
}

export function runGoldenScenario(
  state: WorldState,
  content: ContentPack,
  clock: FixedClock = TEST_CLOCK,
): GoldenLog {
  const result = resolveTick({ state, content });
  return {
    scheduledAt: clock.now().toISOString(),
    header: result.header,
    events: result.events,
    stateHash: result.stateHash,
  };
}

export function goldenPath(name: string): string {
  return join(goldenDir, `${name}.json`);
}

export function expectGolden(name: string, actual: GoldenLog): void {
  const path = goldenPath(name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    return;
  }
  if (!existsSync(path)) {
    throw new Error(
      `Missing golden log ${path}. Run UPDATE_GOLDEN=1 npm run test:golden to record it.`,
    );
  }
  const expected = JSON.parse(readFileSync(path, "utf8")) as GoldenLog;
  expect(actual.events).toEqual(expected.events);
  expect(actual.stateHash).toBe(expected.stateHash);
  expect(actual.header).toEqual(expected.header);
  expect(actual.scheduledAt).toBe(expected.scheduledAt);
}
