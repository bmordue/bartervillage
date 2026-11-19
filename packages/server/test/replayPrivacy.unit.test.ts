/**
 * Replay privacy guard (M5.C05; spec §10).
 *
 * Tick logs and the replay endpoint must contain only public game events.
 * Credentials, OAuth secrets and push subscriptions stay in their own tables.
 */

import { afterEach, describe, expect, it } from "vitest";

import { buildApiRoutes } from "../src/api.js";
import { hashInviteCode } from "../src/db/inviteRepository.js";
import { onboardPlayer } from "../src/db/onboardingRepository.js";
import { subscribePush } from "../src/db/pushRepository.js";
import { resolveWorldTick } from "../src/resolution.js";
import { seedE2eWorld } from "./support/e2e.js";
import { startTestApi, type TestApi } from "./support/harness.js";

const SENSITIVE_VALUES = [
  "public-key-secret",
  "credential-subject-secret",
  "https://push.example/secret-endpoint",
  "p256dh-secret",
  "auth-secret",
];

const FORBIDDEN_KEYS = /credential|public_?key|p256dh|endpoint|secret|token|cookie|session/i;

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, keys);
    }
    return keys;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      keys.push(key);
      collectKeys(entry, keys);
    }
  }
  return keys;
}

let harness: TestApi | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("replay privacy (M5.C05)", () => {
  it("never writes credentials or push subscriptions into tick logs or the replay", async () => {
    harness = await startTestApi({ buildRoutes: (database) => buildApiRoutes(database) });
    const seed = seedE2eWorld(harness.database);

    const onboarded = onboardPlayer(harness.database, {
      playerId: "p1",
      name: "Ada",
      plotId: seed.plotId,
      inviteCodeHash: hashInviteCode(seed.inviteCode),
      sessionId: "session-1",
      credential: {
        id: "credential-1",
        kind: "passkey",
        subject: "credential-subject-secret",
        publicKey: "public-key-secret",
      },
    });
    expect(onboarded.ok).toBe(true);
    subscribePush(
      harness.database,
      "p1",
      "https://push.example/secret-endpoint",
      "p256dh-secret",
      "auth-secret",
    );

    resolveWorldTick(harness.database, seed.worldId);

    const response = await fetch(`${harness.baseUrl}/replay/latest`, {
      headers: { "x-world-id": seed.worldId },
    });
    expect(response.status).toBe(200);
    const replay = (await response.json()) as { header: unknown; events: unknown[] };

    const header = harness.database.get<{ header_json: string }>(
      "SELECT header_json FROM tick_logs WHERE world_id = ?",
      seed.worldId,
    );
    const events = harness.database.all<{ payload_json: string }>(
      "SELECT payload_json FROM archived_events WHERE world_id = ?",
      seed.worldId,
    );

    const serialized = JSON.stringify({
      header: JSON.parse(header?.header_json ?? "{}"),
      events: events.map((event) => JSON.parse(event.payload_json)),
    });

    for (const value of SENSITIVE_VALUES) {
      expect(serialized).not.toContain(value);
      expect(JSON.stringify(replay)).not.toContain(value);
    }

    const keys = collectKeys({
      header: JSON.parse(header?.header_json ?? "{}"),
      events: events.map((event) => JSON.parse(event.payload_json)),
    });
    expect(keys.filter((key) => FORBIDDEN_KEYS.test(key))).toEqual([]);
    expect(replay.events.length).toBeGreaterThan(0);
  });
});
