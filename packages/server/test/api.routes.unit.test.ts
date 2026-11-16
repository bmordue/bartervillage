import { afterEach, describe, expect, it } from "vitest";
import { buildApiRoutes } from "../src/api.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

function insertPlayer(
  database: Parameters<typeof insertWorld>[0],
  id: string,
  plotId: string,
  energy = 100,
): void {
  database.run("INSERT INTO regions (id, x, y, width, height) VALUES (?, 0, 0, 12, 12)", "r1");
  database.run(
    `INSERT INTO players (id, name, plot_id, joined_tick, energy)
     VALUES (?, ?, ?, 0, ?)`,
    id,
    id,
    plotId,
    energy,
  );
  database.run(
    `INSERT INTO plots (id, player_id, region_id, site_x, site_y, width, height)
     VALUES (?, ?, 'r1', 0, 0, 12, 12)`,
    plotId,
    id,
  );
}

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

  it("GET /plot returns held, locked and free inventory", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO inventory (plot_id, item, quantity, locked) VALUES ('plot1', 'wheat', 10, 3)`,
    );
    harness.database.run(
      `INSERT INTO inventory (plot_id, item, quantity, locked) VALUES ('plot1', 'wood', 4, 0)`,
    );

    const response = await fetch(`${harness.baseUrl}/plot/plot1`);

    expect(response.status).toBe(200);
    expect((await response.json()).inventory).toEqual([
      { item: "wheat", quantity: 10, locked: 3, free: 7 },
      { item: "wood", quantity: 4, locked: 0, free: 4 },
    ]);
  });

  it("GET /barter returns only open offers", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO offers
         (id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick,
          expiry_tick, status, parent_offer_id)
       VALUES ('o1', 'p1', 'offer', '[{"item":"wheat","quantity":2}]',
               '[{"item":"wood","quantity":1}]', 1, 0, 7, 'open', NULL)`,
    );
    harness.database.run(
      `INSERT INTO offers
         (id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick,
          expiry_tick, status, parent_offer_id)
       VALUES ('o2', 'p1', 'wanted_request', '[]',
               '[{"item":"stone","quantity":3}]', 1, 0, 7, 'settled', NULL)`,
    );

    const response = await fetch(`${harness.baseUrl}/barter`);

    expect(response.status).toBe(200);
    expect((await response.json()).offers).toEqual([
      {
        id: "o1",
        posterId: "p1",
        kind: "offer",
        gives: [{ item: "wheat", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        quantity: 1,
        createdAtTick: 0,
        expiryTick: 7,
        status: "open",
        parentOfferId: null,
      },
    ]);
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

  it("POST /world/:worldId/ticks/:tick/retry returns 404 for an unknown world", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
      }),
    });

    const response = await fetch(`${harness.baseUrl}/world/missing/ticks/0/retry`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "world_not_found" });
  });

  it("POST /world/:worldId/ticks/:tick/retry rejects an invalid tick", async () => {
    harness = await startTestApi({
      buildRoutes: (database) => ({
        ...buildApiRoutes(database),
      }),
    });

    const response = await fetch(`${harness.baseUrl}/world/w1/ticks/not-a-tick/retry`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_tick" });
  });

  it("POST /player/:playerId/orders returns 404 for an unknown player", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/player/ghost/orders`, {
      method: "POST",
      body: JSON.stringify({ type: "gift", payload: { toPlayerId: "p1", items: [] } }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "player_not_found" });
  });

  it("POST /player/:playerId/orders rejects an order with insufficient energy", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1", 0);

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      body: JSON.stringify({ type: "forage", payload: { nodeId: "n1" } }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Not enough energy");
  });

  it("POST /player/:playerId/orders queues a valid order", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1", 100);

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      body: JSON.stringify({ type: "gift", payload: { toPlayerId: "p2", items: [] } }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.order).toBeDefined();
    expect(data.order.sequence).toBe(1);

    const row = harness.database.get<{ type: string }>(
      "SELECT type FROM orders WHERE player_id = 'p1'",
    );
    expect(row?.type).toBe("gift");
  });

  it("POST /player/:playerId/orders derives the sequence from existing orders", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1", 100);
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('existing', 'p1', 0, 7, 'gift', '{}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      body: JSON.stringify({ type: "gift", payload: { toPlayerId: "p2", items: [] } }),
    });

    expect(response.status).toBe(201);
    expect((await response.json()).order.sequence).toBe(8);
  });

  it("GET /player/:playerId returns energy and ready state", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1", 63);
    harness.database.run(`INSERT INTO ready (player_id, tick, position) VALUES ('p1', 0, 4)`);

    const response = await fetch(`${harness.baseUrl}/player/p1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      player: { id: "p1", plotId: "plot1", energy: 63 },
      ready: { tick: 0, position: 4 },
    });
  });

  it("GET /player/:playerId returns null ready when the player has not readied", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1", 50);

    const response = await fetch(`${harness.baseUrl}/player/p1`);

    expect(response.status).toBe(200);
    expect((await response.json()).ready).toBeNull();
  });

  it("GET /player/:playerId returns 404 for an unknown player", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/player/ghost`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "player_not_found" });
  });
});
