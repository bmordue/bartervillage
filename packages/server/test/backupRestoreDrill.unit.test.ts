/**
 * Automated backup and restore drill (CT.09; spec §12).
 *
 * Backs up a live database, restores it to a fresh path and asserts the restored
 * database contains the same world, tick log and archived events.
 */

import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Database } from "@bartervillage/server";
import { hashInviteCode } from "@bartervillage/server";
import { onboardPlayer } from "@bartervillage/server";
import { resolveWorldTick } from "@bartervillage/server";
import { seedE2eWorld } from "./support/e2e.js";
import { decryptBackup, runBackup } from "../../worker/src/backup.js";

const workDir = mkdtempSync(join(tmpdir(), "bv-drill-"));

describe("backup and restore drill (CT.09)", () => {
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("round-trips a live database through backup and restore", async () => {
    const databasePath = join(workDir, "live.sqlite");
    const database = Database.open({ path: databasePath });
    const seed = seedE2eWorld(database);
    onboardPlayer(database, {
      playerId: "drill-player",
      name: "Drill",
      plotId: seed.plotId,
      inviteCodeHash: hashInviteCode(seed.inviteCode),
      sessionId: "session-1",
    });
    resolveWorldTick(database, seed.worldId);
    database.close();

    const backupWorkDir = join(workDir, "backups");
    const remoteDir = join(workDir, "remote");
    mkdirSync(remoteDir, { recursive: true });
    const result = await runBackup({
      databasePath,
      workDir: backupWorkDir,
      passphrase: "drill-passphrase",
      upload: async (filePath: string, remoteKey: string) => {
        copyFileSync(filePath, join(remoteDir, remoteKey.split("/").pop()!));
      },
    });

    const uploaded = readFileSync(join(remoteDir, result.remoteKey.split("/").pop()!));
    const restored = decryptBackup(uploaded, "drill-passphrase");
    const restorePath = join(workDir, "restored.sqlite");
    writeFileSync(restorePath, restored);

    const restoredDatabase = Database.open({ path: restorePath });
    try {
      const world = restoredDatabase.get(
        "SELECT id, current_tick FROM worlds WHERE id = ?",
        seed.worldId,
      ) as { id: string; current_tick: number } | undefined;
      expect(world).toEqual({ id: seed.worldId, current_tick: 1 });

      const events = restoredDatabase.all(
        "SELECT COUNT(*) AS count FROM archived_events WHERE world_id = ?",
        seed.worldId,
      ) as { count: number }[];
      expect(events[0]?.count).toBeGreaterThan(0);

      const tickLog = restoredDatabase.get(
        "SELECT tick, header_json FROM tick_logs WHERE world_id = ?",
        seed.worldId,
      ) as { tick: number; header_json: string } | undefined;
      expect(tickLog).toBeDefined();
      expect(tickLog?.tick).toBe(world!.current_tick - 1);
      expect(JSON.parse(tickLog?.header_json ?? "{}")).toMatchObject({
        v: 1,
        tick: world!.current_tick - 1,
      });
    } finally {
      restoredDatabase.close();
    }
  });
});
