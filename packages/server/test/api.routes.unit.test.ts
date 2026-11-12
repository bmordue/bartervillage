import { afterEach, describe, expect, it } from "vitest";
import { buildApiRoutes } from "../src/api.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

describe("REST API routes", () => {
  let harness: TestApi | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it("serves the health route as JSON and disables caching", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    const response = await fetch(`${harness.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns a JSON 404 for unknown paths", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
      }),
    });
    const response = await fetch(`${harness.baseUrl}/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("returns 405 for a known path with the wrong method", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    const response = await fetch(`${harness.baseUrl}/health`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  it("passes method, path and headers to custom routes", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /echo": (request) => ({
          status: 200,
          body: { method: request.method, path: request.path, agent: request.headers["x-agent"] },
        }),
      }),
    });

    const response = await fetch(`${harness.baseUrl}/echo?ignored=1`, {
      headers: { "x-agent": "test" },
    });

    expect(await response.json()).toEqual({
      method: "GET",
      path: "/echo",
      agent: "test",
    });
  });

  it("returns a JSON 500 when a handler throws", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /boom": () => {
          throw new Error("boom");
        },
      }),
    });

    const response = await fetch(`${harness.baseUrl}/boom`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });

  it("GET /world returns world state", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/world`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.world).toBeDefined();
    expect(data.world.id).toBe("w1");
    expect(data.world.currentTick).toBeDefined();
    expect(data.world.season).toBeDefined();
    expect(data.world.weather).toBeDefined();
  });

  it("GET /ready returns empty ready state", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/ready`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ready).toBeDefined();
    expect(Array.isArray(data.ready)).toBe(true);
  });

  it("GET /barter returns empty offers", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/barter`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.offers).toBeDefined();
    expect(Array.isArray(data.offers)).toBe(true);
  });

  it("GET /replay/latest returns 404 when no replay data", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/replay/latest`);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("no_replay_data");
  });

  it("GET /push/subscriptions returns empty subscriptions", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/push/subscriptions`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.subscriptions).toBeDefined();
    expect(Array.isArray(data.subscriptions)).toBe(true);
  });

  it("POST /site returns 404 when no available plot", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/site`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1" }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("plot_not_found");
  });

  it("GET /players returns empty players list", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
        "GET /health": () => ({ status: 200, body: { ok: true } }),
      }),
    });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/players`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.players).toBeDefined();
    expect(Array.isArray(data.players)).toBe(true);
  });
});