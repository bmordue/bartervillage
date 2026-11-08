import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/db/database.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("database access layer", () => {
  it("runs prepared statements and reads rows", () => {
    db = Database.open();
    db.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES (?, ?, ?, ?, ?)",
      "p1",
      "P",
      "plot1",
      0,
      100,
    );
    const row = db.get<{ id: string; name: string }>(
      "SELECT id, name FROM players WHERE id = ?",
      "p1",
    );
    expect(row).toEqual({ id: "p1", name: "P" });
    expect(db.all<{ id: string }>("SELECT id FROM players")).toHaveLength(1);
  });

  it("commits successful transactions", () => {
    db = Database.open();
    db.transaction(() => {
      db!.run(
        "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P', 'plot1', 0, 100)",
      );
    });
    expect(db.get("SELECT id FROM players WHERE id = 'p1'")).toBeDefined();
  });

  it("rolls back failed transactions", () => {
    db = Database.open();
    expect(() =>
      db!.transaction(() => {
        db!.run(
          "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'P', 'plot1', 0, 100)",
        );
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.get("SELECT id FROM players WHERE id = 'p1'")).toBeUndefined();
  });
});
