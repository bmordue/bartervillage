import { afterEach, describe, expect, it } from "vitest";
import { buildApiRoutes } from "../src/api.js";
import { acquireResolvingLease, releaseResolvingLease } from "../src/db/worldRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

function insertPlayer(
  database: Parameters<typeof insertWorld>[0],
  id: string,
  plotId: string,
  energy = 100,
  siteX = 0,
  siteY = 0,
): void {
  database.run(
    "INSERT OR IGNORE INTO regions (id, x, y, width, height) VALUES (?, 0, 0, 12, 12)",
    "r1",
  );
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
     VALUES (?, ?, 'r1', ?, ?, 12, 12)`,
    plotId,
    id,
    siteX,
    siteY,
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

  it("GET /plot returns buildings, crops, animals and storage", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO buildings (id, plot_id, type, level) VALUES ('b1', 'plot1', 'home', 1)`,
    );
    harness.database.run(
      `INSERT INTO buildings (id, plot_id, type, level) VALUES ('b2', 'plot1', 'storehouse', 1)`,
    );
    harness.database.run(
      `INSERT INTO crops (id, plot_id, tile_x, tile_y, type, planted_tick, growth_ticks,
                          watered, tended)
       VALUES ('c1', 'plot1', 0, 0, 'wheat', 1, 2, 1, 1)`,
    );
    harness.database.run(
      `INSERT INTO animals (id, plot_id, type, count, fed)
       VALUES ('a1', 'plot1', 'chicken', 2, 1)`,
    );
    harness.database.run(
      `INSERT INTO inventory (plot_id, item, quantity, locked) VALUES ('plot1', 'wheat', 10, 3)`,
    );

    const response = await fetch(`${harness.baseUrl}/plot/plot1`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.buildings).toEqual([
      {
        id: "b1",
        plotId: "plot1",
        type: "home",
        level: 1,
        constructionKind: null,
        constructionCompleteTick: null,
      },
      {
        id: "b2",
        plotId: "plot1",
        type: "storehouse",
        level: 1,
        constructionKind: null,
        constructionCompleteTick: null,
      },
    ]);
    expect(data.crops).toEqual([
      {
        id: "c1",
        plotId: "plot1",
        tileX: 0,
        tileY: 0,
        type: "wheat",
        plantedTick: 1,
        growthTicks: 2,
        watered: true,
        tended: true,
        failed: false,
      },
    ]);
    expect(data.animals).toEqual([
      { id: "a1", plotId: "plot1", type: "chicken", count: 2, fed: true },
    ]);
    expect(data.storage).toEqual({ capacity: 100, used: 10, free: 90 });
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
    harness.database.run(
      `INSERT INTO inventory (plot_id, item, quantity, locked)
       VALUES ('plot1', 'wheat', 5, 2)`,
    );
    harness.database.run(
      `INSERT INTO inventory (plot_id, item, quantity, locked)
       VALUES ('plot1', 'wood', 4, 0)`,
    );

    const response = await fetch(`${harness.baseUrl}/barter`);

    expect(response.status).toBe(200);
    expect((await response.json()).offers).toEqual([
      {
        id: "o1",
        posterId: "p1",
        posterName: "p1",
        kind: "offer",
        gives: [{ item: "wheat", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        quantity: 1,
        createdAtTick: 0,
        expiryTick: 7,
        status: "open",
        parentOfferId: null,
        posterFreeStock: [
          { item: "wheat", free: 3 },
          { item: "wood", free: 4 },
        ],
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

  it("GET /players lists every player with their plot", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p2", "plot2", 80, 1, 0);
    insertPlayer(harness.database, "p1", "plot1", 90);

    const response = await fetch(`${harness.baseUrl}/players`);

    expect(response.status).toBe(200);
    expect((await response.json()).players).toEqual([
      { id: "p1", name: "p1", plotId: "plot1", energy: 90 },
      { id: "p2", name: "p2", plotId: "plot2", energy: 80 },
    ]);
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

  it("GET /player/:playerId/orders returns queued orders in sequence order", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('second', 'p1', 0, 2, 'harvest', '{"tile":{"x":1,"y":0}}', 'queued')`,
    );
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('first', 'p1', 0, 1, 'plant', '{"tile":{"x":0,"y":0}}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`);

    expect(response.status).toBe(200);
    expect((await response.json()).orders.map((order: { id: string }) => order.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("DELETE /player/:playerId/orders/:orderId removes a queued order", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('o1', 'p1', 0, 1, 'plant', '{}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p1/orders/o1`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, orderId: "o1" });
    expect(
      harness.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM orders")?.count,
    ).toBe(0);
  });

  it("DELETE /player/:playerId/orders/:orderId rejects another player's order", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('o1', 'p1', 0, 1, 'plant', '{}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p2/orders/o1`, { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "order_not_found" });
    expect(
      harness.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM orders")?.count,
    ).toBe(1);
  });

  it("PUT /player/:playerId/orders reorders the whole queue", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('first', 'p1', 0, 1, 'plant', '{}', 'queued')`,
    );
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('second', 'p1', 0, 2, 'harvest', '{}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderIds: ["second", "first"] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const rows = harness.database.all<{ id: string; sequence: number }>(
      "SELECT id, sequence FROM orders ORDER BY sequence",
    );
    expect(rows).toEqual([
      { id: "second", sequence: 1 },
      { id: "first", sequence: 2 },
    ]);
  });

  it("PUT /player/:playerId/orders rejects an incomplete queue", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('first', 'p1', 0, 1, 'plant', '{}', 'queued')`,
    );

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderIds: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_queue" });
  });

  it("returns 409 for queue edits while a tick is resolving", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", "plot1");
    harness.database.run(
      `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
       VALUES ('o1', 'p1', 0, 1, 'plant', '{}', 'queued')`,
    );
    acquireResolvingLease(harness.database, "w1", { owner: "worker-1" });

    const response = await fetch(`${harness.baseUrl}/player/p1/orders/o1`, { method: "DELETE" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "tick_in_progress" });
    releaseResolvingLease(harness.database, "w1", "worker-1");
  });
});
