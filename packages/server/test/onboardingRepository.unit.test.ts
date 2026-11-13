import { afterEach, describe, expect, it } from "vitest";

import { content } from "@bartervillage/content";
import { generateRegion, MAP_GENERATOR_VERSION } from "@bartervillage/rules";

import { Database } from "../src/db/database.js";
import {
  createInviteCode,
  findInviteByCodeHash,
  hashInviteCode,
  issueInvite,
} from "../src/db/inviteRepository.js";
import { loadPlots, persistMap } from "../src/db/mapRepository.js";
import { onboardPlayer } from "../src/db/onboardingRepository.js";
import { loadSession } from "../src/db/sessionRepository.js";
import { insertWorld } from "./support/harness.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function open(): { database: Database; codeHash: string; sites: string[] } {
  const database = Database.open();
  db = database;
  const generated = generateRegion("seed", MAP_GENERATOR_VERSION, 0, 0, content);
  persistMap(database, [generated]);
  const codeHash = hashInviteCode(createInviteCode());
  issueInvite(database, { id: "invite-1", codeHash });
  const sites = loadPlots(database)
    .filter((plot) => !plot.worldOwned)
    .map((plot) => plot.id);
  return { database, codeHash, sites };
}

describe("transactional onboarding", () => {
  it("claims a site, redeems the invite and creates the session", () => {
    const { database, codeHash, sites } = open();
    const site = sites[0];
    expect(site).toBeDefined();

    const result = onboardPlayer(database, {
      playerId: "p1",
      name: "Ada",
      plotId: site!,
      inviteCodeHash: codeHash,
      sessionId: "s1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.playerId).toBe("p1");
    expect(loadSession(database, "s1")?.playerId).toBe("p1");
    expect(loadPlots(database).find((plot) => plot.id === site!)?.playerId).toBe("p1");
    expect(
      database.all("SELECT type FROM buildings WHERE plot_id = ? ORDER BY type", site!),
    ).toEqual([{ type: "field" }, { type: "home" }, { type: "storehouse" }]);
    expect(findInviteByCodeHash(database, codeHash)?.redeemedByPlayerId).toBe("p1");
  });

  it("rolls everything back for an invalid invite", () => {
    const { database, sites } = open();
    const site = sites[0]!;

    const result = onboardPlayer(database, {
      playerId: "p1",
      name: "Ada",
      plotId: site,
      inviteCodeHash: hashInviteCode("unknown"),
      sessionId: "s1",
    });

    expect(result).toEqual({ ok: false, reason: "invite_invalid" });
    expect(database.get("SELECT id FROM players WHERE id = 'p1'")).toBeUndefined();
    expect(loadPlots(database).find((plot) => plot.id === site)?.playerId).toBeNull();
    expect(database.get("SELECT id FROM buildings WHERE plot_id = ?", site)).toBeUndefined();
    expect(loadSession(database, "s1")).toBeUndefined();
  });

  it("loses a site that was claimed first write wins", () => {
    const { database, codeHash, sites } = open();
    const site = sites[0]!;
    database.run(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p0', 'Old', 'other', 0, 100)",
    );
    database.run("UPDATE plots SET player_id = 'p0' WHERE id = ?", site);

    const result = onboardPlayer(database, {
      playerId: "p1",
      name: "Ada",
      plotId: site,
      inviteCodeHash: codeHash,
      sessionId: "s1",
    });

    expect(result).toEqual({ ok: false, reason: "site_unavailable" });
    expect(database.get("SELECT id FROM players WHERE id = 'p1'")).toBeUndefined();
    expect(findInviteByCodeHash(database, codeHash)?.redeemedByPlayerId).toBeNull();
    expect(loadPlots(database).find((plot) => plot.id === site)?.playerId).toBe("p0");
  });

  it("refuses an invite once the world player cap is reached", () => {
    const { database, sites } = open();
    insertWorld(database);
    database.run("UPDATE worlds SET player_cap = 2 WHERE id = 'w1'");
    const codes = [
      hashInviteCode(createInviteCode()),
      hashInviteCode(createInviteCode()),
      hashInviteCode(createInviteCode()),
    ];
    codes.forEach((codeHash, index) => {
      issueInvite(database, { id: `invite-cap-${index}`, codeHash });
    });

    expect(
      onboardPlayer(database, {
        playerId: "p1",
        name: "Ada",
        plotId: sites[0]!,
        inviteCodeHash: codes[0]!,
        sessionId: "s1",
      }).ok,
    ).toBe(true);
    expect(
      onboardPlayer(database, {
        playerId: "p2",
        name: "Grace",
        plotId: sites[1]!,
        inviteCodeHash: codes[1]!,
        sessionId: "s2",
      }).ok,
    ).toBe(true);

    const third = onboardPlayer(database, {
      playerId: "p3",
      name: "Lin",
      plotId: sites[2]!,
      inviteCodeHash: codes[2]!,
      sessionId: "s3",
    });

    expect(third).toEqual({ ok: false, reason: "player_cap_reached" });
    expect(database.get("SELECT id FROM players WHERE id = 'p3'")).toBeUndefined();
    expect(findInviteByCodeHash(database, codes[2]!)?.redeemedByPlayerId).toBeNull();
    expect(loadPlots(database).find((plot) => plot.id === sites[2]!)?.playerId).toBeNull();
    expect(loadSession(database, "s3")).toBeUndefined();
  });

  it("never admits more than twenty players even if the world cap is higher", () => {
    const { database, sites } = open();
    insertWorld(database);
    database.run("UPDATE worlds SET player_cap = 25 WHERE id = 'w1'");
    for (let index = 0; index < 20; index += 1) {
      database.run(
        "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES (?, ?, ?, 0, 100)",
        `p${index}`,
        `Player ${index}`,
        `plot-${index}`,
      );
    }
    const codeHash = hashInviteCode(createInviteCode());
    issueInvite(database, { id: "invite-21", codeHash });

    const result = onboardPlayer(database, {
      playerId: "p21",
      name: "Twenty-first",
      plotId: sites[0]!,
      inviteCodeHash: codeHash,
      sessionId: "s21",
    });

    expect(result).toEqual({ ok: false, reason: "player_cap_reached" });
    expect(database.get("SELECT id FROM players WHERE id = 'p21'")).toBeUndefined();
  });

  it("does not let one invite create a second player", () => {
    const { database, codeHash, sites } = open();

    expect(
      onboardPlayer(database, {
        playerId: "p1",
        name: "Ada",
        plotId: sites[0]!,
        inviteCodeHash: codeHash,
        sessionId: "s1",
      }).ok,
    ).toBe(true);

    const second = onboardPlayer(database, {
      playerId: "p2",
      name: "Grace",
      plotId: sites[1]!,
      inviteCodeHash: codeHash,
      sessionId: "s2",
    });

    expect(second).toEqual({ ok: false, reason: "invite_invalid" });
    expect(database.get("SELECT id FROM players WHERE id = 'p2'")).toBeUndefined();
    expect(loadPlots(database).find((plot) => plot.id === sites[1]!)?.playerId).toBeNull();
  });
});
