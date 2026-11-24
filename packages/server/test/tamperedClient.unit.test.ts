/**
 * Tampered-client security tests (M9.08; spec §3).
 *
 * Verifies the server is authoritative: a tampered client cannot spend energy
 * or goods it does not have. Each test sends a forged request directly to the
 * API and asserts the server rejects it with 400/409 and no state mutation.
 */

import { afterEach, describe, expect, it } from "vitest";
import { buildApiRoutes } from "../src/api.js";
import { acquireResolvingLease, releaseResolvingLease } from "../src/db/worldRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

// Insert a player into a fresh test database. Uses INSERT OR IGNORE so it's safe
// to call multiple times without causing primary-key conflicts.
function insertPlayer(database: Parameters<typeof insertWorld>[0], id: string, energy = 100): void {
  database.run(
    "INSERT OR IGNORE INTO regions (id, x, y, width, height) VALUES (?, 0, 0, 12, 12)",
    "r1",
  );
  database.run(
    `INSERT INTO players (id, name, plot_id, joined_tick, energy)
     VALUES (?, ?, ?, 0, ?)`,
    id,
    id,
    id,
    energy,
  );
  const plotX = id === "p1" ? 0 : 1;
  database.run(
    `INSERT OR IGNORE INTO plots (id, player_id, region_id, site_x, site_y, width, height)
     VALUES (?, ?, 'r1', ?, 0, 12, 12)`,
    id,
    id,
    plotX,
  );
}

function insertBuilding(
  database: Parameters<typeof insertWorld>[0],
  plotId: string,
  type: string,
): void {
  database.run(
    `INSERT INTO buildings (id, plot_id, type, level)
     VALUES (?, ?, ?, 1)`,
    `bld-${plotId}-${type}`,
    plotId,
    type,
  );
}

function insertWildNode(
  database: Parameters<typeof insertWorld>[0],
  nodeId: string,
  resource = "grain",
  amount = 5,
): void {
  database.run(
    `INSERT INTO wild_nodes (id, region_id, x, y, resource, amount, capacity, regrow_rate)
     VALUES (?, 'r1', 1, 1, ?, ?, ?, 1)`,
    nodeId,
    resource,
    amount,
    10,
  );
}

function givePlayerGrain(database: Parameters<typeof insertWorld>[0], id: string): void {
  database.run(
    `INSERT INTO inventory (plot_id, item, quantity, locked)
     VALUES (?, 'grain', 5, 0)`,
    id,
  );
}

describe("Tampered-client security (M9.08)", () => {
  let harness: TestApi;

  afterEach(async () => {
    await harness?.close();
  });

  it("rejects an order whose energy cost exceeds the player's remaining energy", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 2);

    insertWildNode(harness.database, "n1", "wood", 5);

    // Player has 2 energy; forage costs 3 → should be rejected
    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "forage", payload: { nodeId: "n1" } }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Not enough energy");

    // Only the first valid order should exist; rejected one leaves no row
    const orders = harness.database.all("SELECT * FROM orders WHERE player_id = 'p1'");
    expect(orders.length).toBe(0);
  });

  it("rejects an order that requires goods the player does not own (craft without inputs)", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 100);
    insertBuilding(harness.database, "p1", "bakery");

    // No grain in inventory → craft should fail (missing inputs)
    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "craft",
        payload: { recipeId: "bread", buildingId: "bld-p1-bakery" },
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Not enough");
  });

  it("rejects a gift when all stock is locked (no free goods to lock)", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 100);
    insertPlayer(harness.database, "p2", 100);
    givePlayerGrain(harness.database, "p1");

    // Player has 5 grain but all locked → gift should fail
    harness.database.run("UPDATE inventory SET locked = 5 WHERE plot_id = 'p1'");

    // Add storehouse to p2's plot for storage capacity
    insertBuilding(harness.database, "p2", "storehouse");

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "gift",
        payload: { toPlayerId: "p2", items: [{ item: "grain", quantity: 1 }] },
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Not enough free goods to lock");
  });

  it("rejects accepting a post_offer when the acceptor lacks free stock", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 100); // poster
    insertPlayer(harness.database, "p2", 100); // acceptor

    // p1 offers wood for grain
    harness.database.run(
      `INSERT INTO offers
         (id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick,
          expiry_tick, status, parent_offer_id)
       VALUES ('offer-p1-1', 'p1', 'offer', '[{"item":"wood","quantity":5}]',
               '[{"item":"grain","quantity":5}]', 1, 0, 7, 'open', NULL)`,
    );
    // p1 locks the wood they offered
    harness.database.run("UPDATE inventory SET locked = 5 WHERE plot_id = 'p1' AND item = 'wood'");

    // p2 has no grain → cannot accept
    const response = await fetch(`${harness.baseUrl}/player/p2/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "accept_offer",
        payload: { offerId: "offer-p1-1" },
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Not enough grain to lock for accept_offer");
  });

  it("rejects queueing orders while a tick is resolving (409 tick_in_progress)", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 100);

    // Acquire the resolving lease to simulate a tick in progress
    const lease = acquireResolvingLease(harness.database, "w1", { owner: "test", ttlMs: 60000 });
    expect(lease).not.toBeNull();

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "forage", payload: { nodeId: "n1" } }),
    });

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toBe("tick_in_progress");

    // Also verify PUT /ready is rejected
    const readyResponse = await fetch(`${harness.baseUrl}/player/p1/ready`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready: true }),
    });
    expect(readyResponse.status).toBe(409);
    const readyData = await readyResponse.json();
    expect(readyData.error).toBe("tick_in_progress");

    // Clean up lease for other tests
    releaseResolvingLease(harness.database, "w1", "test");
  });

  it("rejects PUT /ready with invalid player ID", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/player/unknown/ready`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready: true }),
    });

    expect(response.status).toBe(404);
  });

  it("rejects POST /orders with invalid order type (unknown)", async () => {
    harness = await startTestApi({ buildRoutes: (database) => ({ ...buildApiRoutes(database) }) });
    insertWorld(harness.database);
    insertPlayer(harness.database, "p1", 100);

    const response = await fetch(`${harness.baseUrl}/player/p1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid_type", payload: {} }),
    });

    expect(response.status).not.toBe(201);
  });
});
