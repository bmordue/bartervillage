/**
 * End-to-end harness (CT.06; spec §3, §12).
 *
 * Runs onboarding, a day of queued orders, tick resolution and replay playback
 * against the real API and database, using the client's own order and replay
 * modules for the read/write path.
 */

import { afterEach, describe, expect, it } from "vitest";

import { addOrders, fetchOrders } from "../../client/src/orders.js";
import { ReplayPlayback, fetchLatestReplay } from "../../client/src/replay.js";

import { buildApiRoutes } from "../src/api.js";
import { resolveWorldTick } from "../src/resolution.js";
import { createTestPasskey, onboardViaPasskey, seedE2eWorld } from "./support/e2e.js";
import { startTestApi, type TestApi } from "./support/harness.js";

let harness: TestApi | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("end-to-end flow (CT.06)", () => {
  it("onboards, queues a day of orders, resolves a tick and plays the replay", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => buildApiRoutes(database, { passkey: createTestPasskey() }),
    });
    const seed = seedE2eWorld(harness.database);
    const player = await onboardViaPasskey(harness.baseUrl, seed);

    expect(player.playerId).toMatch(/^player-/);
    expect(player.plotId).toBe(seed.plotId);
    expect(player.csrfToken.length).toBeGreaterThan(10);

    const credentials = await fetch(`${harness.baseUrl}/auth/credentials`, {
      headers: { cookie: `bv_session=${player.sessionCookie}` },
    });
    expect(credentials.status).toBe(200);
    expect(((await credentials.json()) as { credentials: unknown[] }).credentials).toHaveLength(1);

    const plot = harness.database.get<{ width: number; height: number }>(
      "SELECT width, height FROM plots WHERE id = ?",
      player.plotId,
    );
    expect(plot).toBeDefined();
    const tileCount = Math.min(10, (plot?.width ?? 0) * (plot?.height ?? 0));
    const drafts = Array.from({ length: tileCount }, (_, index) => ({
      type: "plant",
      payload: {
        tile: { x: index % (plot?.width ?? 1), y: Math.floor(index / (plot?.width ?? 1)) },
        crop: "wheat",
      },
    }));
    expect(drafts.length).toBeGreaterThan(0);

    const queued = await addOrders(harness.baseUrl, seed.worldId, player.playerId, drafts);
    expect(queued).toHaveLength(drafts.length);
    expect(await fetchOrders(harness.baseUrl, seed.worldId, player.playerId)).toHaveLength(
      drafts.length,
    );

    const result = resolveWorldTick(harness.database, seed.worldId);
    const planted = result.events.filter(
      (event) => event.type === "order_resolved" && event.payload.orderType === "plant",
    );
    expect(planted).toHaveLength(drafts.length);

    const replay = await fetchLatestReplay(harness.baseUrl, seed.worldId);
    expect(replay.tick).toBe(result.header.tick);
    expect(replay.events).toHaveLength(result.events.length);

    const playback = new ReplayPlayback(replay);
    const played = [];
    for (let event = playback.next(); event !== undefined; event = playback.next()) {
      played.push(event);
    }
    expect(played.map((event) => event.sequence)).toEqual(
      replay.events.map((event) => event.sequence),
    );
    expect(played.filter((event) => event.type === "order_resolved")).toHaveLength(drafts.length);
    expect(playback.isDone).toBe(true);
    expect(playback.progress).toBe(1);
  });
});
