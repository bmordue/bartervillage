import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../src/db/database.js";
import {
  createInviteCode,
  findInviteByCodeHash,
  hashInviteCode,
  issueInvite,
  listInvites,
  redeemInvite,
} from "../src/db/inviteRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function open(): Database {
  const database = Database.open();
  db = database;
  for (const [id, name] of [
    ["p1", "Ada"],
    ["p2", "Grace"],
  ]) {
    database.run(
      `INSERT INTO players (id, name, plot_id, joined_tick, energy)
       VALUES (?, ?, ?, 0, 100)`,
      id,
      name,
      `plot-${id}`,
    );
  }
  return database;
}

const t0 = new Date("2026-11-07T20:00:00.000Z");

describe("invite repository", () => {
  it("issues an unredeemed invite storing only the code hash", () => {
    const database = open();
    const code = createInviteCode();

    const invite = issueInvite(database, {
      id: "i1",
      codeHash: hashInviteCode(code),
      createdByPlayerId: "p1",
      now: t0,
    });

    expect(invite).toEqual({
      id: "i1",
      codeHash: hashInviteCode(code),
      createdByPlayerId: "p1",
      redeemedByPlayerId: null,
      createdAt: "2026-11-07T20:00:00.000Z",
      redeemedAt: null,
    });
    expect(findInviteByCodeHash(database, hashInviteCode(code))).toEqual(invite);
  });

  it("redeems a code exactly once", () => {
    const database = open();
    const codeHash = hashInviteCode(createInviteCode());
    issueInvite(database, { id: "i1", codeHash });

    expect(redeemInvite(database, codeHash, "p1", t0)).toBe(true);
    expect(redeemInvite(database, codeHash, "p2", t0)).toBe(false);
    expect(findInviteByCodeHash(database, codeHash)).toMatchObject({
      redeemedByPlayerId: "p1",
      redeemedAt: "2026-11-07T20:00:00.000Z",
    });
  });

  it("rejects an unknown code", () => {
    expect(redeemInvite(open(), hashInviteCode("unknown"), "p1")).toBe(false);
  });

  it("generates distinct codes and deterministic hashes", () => {
    const first = createInviteCode();
    const second = createInviteCode();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(20);
    expect(hashInviteCode(first)).toBe(hashInviteCode(first));
    expect(hashInviteCode(first)).not.toBe(hashInviteCode(second));
  });

  it("lists invites in creation order", () => {
    const database = open();
    issueInvite(database, {
      id: "i2",
      codeHash: hashInviteCode("b"),
      now: new Date(t0.getTime() + 1),
    });
    issueInvite(database, { id: "i1", codeHash: hashInviteCode("a"), now: t0 });

    expect(listInvites(database).map((invite) => invite.id)).toEqual(["i1", "i2"]);
  });
});
