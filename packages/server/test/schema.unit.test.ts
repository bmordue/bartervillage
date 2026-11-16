import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, migrate } from "../src/db/migrate.js";
import { MIGRATIONS } from "../src/db/schema.js";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function tableNames(database: DatabaseSync): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("schema migrations", () => {
  it("creates every spec §13 entity table", () => {
    db = openDatabase();
    const names = tableNames(db);
    for (const table of [
      "worlds",
      "players",
      "credentials",
      "sessions",
      "invites",
      "push_subscriptions",
      "regions",
      "tiles",
      "plots",
      "buildings",
      "craft_jobs",
      "crops",
      "animals",
      "inventory",
      "orders",
      "ready",
      "offers",
      "wild_nodes",
      "wild_claims",
      "goals",
      "contributions",
      "goodwill",
      "decorations",
      "tick_logs",
      "archived_events",
      "avatar_paths",
    ]) {
      expect(names).toContain(table);
    }
  });

  it("never stores passwords and only has ciphertext for credential secrets", () => {
    db = openDatabase();
    const columns = db.prepare("PRAGMA table_info(credentials)").all() as { name: string }[];
    const names = columns.map((column) => column.name);

    expect(names).toContain("secret_ciphertext");
    expect(names).not.toContain("password");
    expect(names).not.toContain("secret");
    expect(names).not.toContain("token");
  });

  it("contains no currency or coin concept (M3.03)", () => {
    const forbidden =
      /\b(currency|coins?|money|cash|gold|silver|dollars?|credits?|wallet|balance|prices?)\b/i;

    for (const migration of MIGRATIONS) {
      expect(migration.sql).not.toMatch(forbidden);
    }
    db = openDatabase();
    for (const table of tableNames(db)) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      for (const column of columns) {
        expect(column.name).not.toMatch(forbidden);
      }
    }
  });

  it("is idempotent", () => {
    db = openDatabase();
    expect(migrate(db)).toEqual([]);
  });

  it("enforces inventory and wild-node constraints", () => {
    db = openDatabase();
    db.exec(`
      INSERT INTO worlds (id, seed, generator_version, content_version, rules_version,
        deadline_time, timezone, min_tick_gap_minutes, player_cap, season, weather)
      VALUES ('w1', 's', 'g1', 'c1', 'r1', '20:00', 'UTC', 60, 20, 'spring', 'clear');
      INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P', 'plot1', 0, 100);
      INSERT INTO regions (id, x, y, width, height) VALUES ('r1', 0, 0, 12, 12);
      INSERT INTO plots (id, player_id, region_id, site_x, site_y, width, height) VALUES ('plot1', 'p1', 'r1', 0, 0, 12, 12);
      INSERT INTO inventory (plot_id, item, quantity, locked) VALUES ('plot1', 'wood', 1, 1);
      INSERT INTO wild_nodes (id, region_id, x, y, resource, amount, capacity, regrow_rate)
      VALUES ('n1', 'r1', 1, 1, 'wood', 2, 3, 1);
    `);
    expect(() =>
      db!.exec("UPDATE inventory SET locked = 2 WHERE plot_id = 'plot1' AND item = 'wood'"),
    ).toThrow();
    expect(() => db!.exec("UPDATE wild_nodes SET amount = 4 WHERE id = 'n1'")).toThrow();
  });

  it("keeps ready positions unique per tick", () => {
    db = openDatabase();
    db.exec(`
      INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES
        ('p1', 'P1', 'plot1', 0, 100), ('p2', 'P2', 'plot2', 0, 100);
      INSERT INTO ready (player_id, tick, position) VALUES ('p1', 5, 1);
    `);
    expect(() =>
      db!.exec("INSERT INTO ready (player_id, tick, position) VALUES ('p2', 5, 1)"),
    ).toThrow();
  });

  it("enforces spec §13 offer, order and goal domain constraints", () => {
    db = openDatabase();
    const insertOffer = (values: string): void => {
      db!.exec(`
        INSERT INTO offers
          (id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick, expiry_tick,
           status, parent_offer_id)
        VALUES ${values}
      `);
    };
    db.exec(`
      INSERT INTO players (id, name, plot_id, joined_tick, energy)
      VALUES ('p1', 'P1', 'plot1', 0, 100);
    `);
    insertOffer(
      `('o1', 'p1', 'offer', '[{"item":"wheat","quantity":1}]',
        '[{"item":"wood","quantity":1}]', 1, 5, 12, 'open', NULL)`,
    );

    expect(() => insertOffer(`('o2', 'p1', 'offer', '[]', '[]', 1, 5, 34, 'open', NULL)`)).toThrow(
      /1\.\.28/,
    );
    expect(() => insertOffer(`('o3', 'p1', 'offer', '[]', '[]', 1, 5, 12, 'open', 'o1')`)).toThrow(
      /only counter-offers/,
    );
    expect(() =>
      insertOffer(`('o4', 'p1', 'counter_offer', '[]', '[]', 1, 5, 12, 'cancelled', NULL)`),
    ).toThrow(/only counter-offers/);
    expect(() =>
      insertOffer(
        `('o5', 'p1', 'wanted_request', '[{"item":"wheat","quantity":1}]', '[]', 1, 5, 12, 'open', NULL)`,
      ),
    ).toThrow(/must not lock goods/);
    expect(() => insertOffer(`('o6', 'p1', 'offer', '{}', '[]', 1, 5, 12, 'open', NULL)`)).toThrow(
      /JSON arrays/,
    );
    expect(() =>
      insertOffer(`('o7', 'p1', 'offer', '[]', '[]', 1, 5, 12, 'unknown', NULL)`),
    ).toThrow(/invalid offer status/);

    insertOffer(`('c1', 'p1', 'counter_offer', '[]', '[]', 1, 5, 12, 'open', 'o1')`);
    expect(() =>
      insertOffer(`('c2', 'p1', 'counter_offer', '[]', '[]', 1, 5, 12, 'open', 'c1')`),
    ).toThrow(/depth/);

    insertOffer(`('o8', 'p1', 'offer', '[]', '[]', 1, 5, 12, 'cancelled', NULL)`);
    expect(() =>
      insertOffer(`('c3', 'p1', 'counter_offer', '[]', '[]', 1, 5, 12, 'open', 'o8')`),
    ).toThrow(/open parent/);
    expect(() =>
      insertOffer(`('c4', 'p1', 'counter_offer', '[]', '[]', 1, 5, 12, 'cancelled', 'o8')`),
    ).not.toThrow();
    expect(() => db!.exec("UPDATE offers SET expiry_tick = 100 WHERE id = 'o1'")).toThrow(
      /1\.\.28/,
    );

    expect(() =>
      db!.exec(`
        INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
        VALUES ('ord1', 'p1', 5, 1, 'explode', '{}', 'queued')
      `),
    ).toThrow(/invalid order type/);
    expect(() =>
      db!.exec(`
        INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status)
        VALUES ('ord2', 'p1', 5, 2, 'travel', '{}', 'waiting')
      `),
    ).toThrow(/invalid order status/);

    expect(() =>
      db!.exec(`
        INSERT INTO goals
          (id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick, status)
        VALUES ('g1', 'party', 'Party', '[]', '[]', 5, 10, 'active')
      `),
    ).toThrow(/invalid goal kind/);
    expect(() =>
      db!.exec(`
        INSERT INTO goals
          (id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick, status)
        VALUES ('g2', 'festival', 'Festival', '[]', '[]', 5, 10, 'pending')
      `),
    ).toThrow(/invalid goal status/);
    expect(() =>
      db!.exec(`
        INSERT INTO goals
          (id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick, status)
        VALUES ('g3', 'festival', 'Festival', '[]', '[]', 5, 5, 'active')
      `),
    ).toThrow(/after creation/);
  });
});
