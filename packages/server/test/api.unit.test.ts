import { afterEach, describe, expect, it } from "vitest";
import { startApiServer, type RunningApiServer } from "../src/api.js";

let running: RunningApiServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("REST API transport", () => {
  it("serves the health route as JSON and disables caching", async () => {
    running = await startApiServer();
    const response = await fetch(`http://127.0.0.1:${running.port}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns a JSON 404 for unknown paths", async () => {
    running = await startApiServer();
    const response = await fetch(`http://127.0.0.1:${running.port}/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("returns 405 for a known path with the wrong method", async () => {
    running = await startApiServer();
    const response = await fetch(`http://127.0.0.1:${running.port}/health`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  it("passes method, path and headers to custom routes", async () => {
    running = await startApiServer({
      routes: {
        "GET /echo": (request) => ({
          status: 200,
          body: { method: request.method, path: request.path, agent: request.headers["x-agent"] },
        }),
      },
    });
    const response = await fetch(`http://127.0.0.1:${running.port}/echo?ignored=1`, {
      headers: { "x-agent": "test" },
    });

    expect(await response.json()).toEqual({
      method: "GET",
      path: "/echo",
      agent: "test",
    });
  });

  it("returns a JSON 500 when a handler throws", async () => {
    running = await startApiServer({
      routes: {
        "GET /boom": () => {
          throw new Error("boom");
        },
      },
    });
    const response = await fetch(`http://127.0.0.1:${running.port}/boom`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });
});
