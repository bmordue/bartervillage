import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { loadWorld } from "../src/db/worldRepository.js";
import { insertWorld, startTestApi, type TestApi } from "./support/harness.js";

let harness: TestApi | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("API/database test harness", () => {
  it("serves the API against a migrated file database", async () => {
    harness = await startTestApi();
    insertWorld(harness.database);

    const response = await fetch(`${harness.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(loadWorld(harness.database, "w1")?.config.contentVersion).toBe("content-1");
  });

  it("uses a temporary database path and removes it on close", async () => {
    harness = await startTestApi();
    const databasePath = harness.databasePath;

    expect(existsSync(databasePath)).toBe(true);

    await harness.close();
    harness = undefined;

    expect(existsSync(databasePath)).toBe(false);
  });

  it("accepts custom routes", async () => {
    harness = await startTestApi({
      routes: {
        "GET /ping": () => ({ status: 200, body: { pong: true } }),
      },
    });

    const response = await fetch(`${harness.baseUrl}/ping`);

    expect(await response.json()).toEqual({ pong: true });
  });
});
