import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireResolvingLease, releaseResolvingLease } from "../src/db/worldRepository.js";
import { checkMutationAllowed, guardMutation } from "../src/mutations.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

let harness: TestApi | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("resolving-lease mutation guard", () => {
  it("allows mutations when no lease is held", async () => {
    harness = await startTestApi();
    insertWorld(harness.database);

    expect(checkMutationAllowed(harness.database, "w1")).toEqual({ allowed: true });
  });

  it("returns 409 while the lease is held", async () => {
    harness = await startTestApi();
    insertWorld(harness.database);
    acquireResolvingLease(harness.database, "w1", { owner: "worker-1" });

    expect(checkMutationAllowed(harness.database, "w1")).toEqual({
      allowed: false,
      status: 409,
      body: { error: "tick_in_progress" },
    });
  });

  it("allows mutations once the lease has expired", async () => {
    harness = await startTestApi();
    insertWorld(harness.database);
    const acquiredAt = new Date("2026-11-07T20:00:00.000Z");
    acquireResolvingLease(harness.database, "w1", {
      owner: "worker-1",
      now: acquiredAt,
      ttlMs: 1000,
    });

    expect(
      checkMutationAllowed(harness.database, "w1", new Date(acquiredAt.getTime() + 1001)),
    ).toEqual({ allowed: true });
  });

  it("returns 404 for an unknown world", async () => {
    harness = await startTestApi();

    expect(checkMutationAllowed(harness.database, "missing")).toEqual({
      allowed: false,
      status: 404,
      body: { error: "world_not_found" },
    });
  });

  it("guards an HTTP mutation route", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        "POST /act": guardMutation(() => ({ status: 200, body: { ok: true } }), {
          database,
          worldId: "w1",
        }),
      }),
    });
    insertWorld(harness.database);

    acquireResolvingLease(harness.database, "w1", { owner: "worker-1" });
    const blocked = await fetch(`${harness.baseUrl}/act`, { method: "POST" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "tick_in_progress" });

    releaseResolvingLease(harness.database, "w1", "worker-1");
    const allowed = await fetch(`${harness.baseUrl}/act`, { method: "POST" });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });
  });

  it("uses the injected clock for the lease check", async () => {
    harness = await startTestApi();
    insertWorld(harness.database);
    acquireResolvingLease(harness.database, "w1", { owner: "worker-1", ttlMs: 1000 });

    const handler = vi.fn(() => ({ status: 200, body: { ok: true } }));
    const guarded = guardMutation(handler, {
      database: harness.database,
      worldId: "w1",
      now: () => new Date(Date.now() + 2000),
    });

    expect(guarded({ method: "POST", path: "/act", headers: {} })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
