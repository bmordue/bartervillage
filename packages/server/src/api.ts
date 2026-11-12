/**
 * Plain REST/JSON API process (spec §12; M4.B01).
 *
 * One Node HTTP server, no framework. Responses are JSON with `no-store` so the
 * polling client always sees current state. Feature endpoints are layered on in
 * M4.B02; this module owns transport concerns and the health route.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface JsonResponse {
  status: number;
  body: unknown;
}

export interface ApiRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body?: unknown;
}

export type RouteHandler = (request: ApiRequest) => JsonResponse | Promise<JsonResponse>;

/** Routes keyed as `"METHOD /path"`. */
export type Routes = Record<string, RouteHandler>;

export interface ApiServerOptions {
  routes?: Routes;
  logger?: (message: string) => void;
}

export const POLL_INTERVAL_MS = 5000;

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function requestPath(request: IncomingMessage): string {
  const url = request.url ?? "/";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function defaultRoutes(): Routes {
  return {
    "GET /health": () => ({ status: 200, body: { ok: true } }),
  };
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const routes = options.routes ?? defaultRoutes();
  const logger = options.logger ?? (() => undefined);

  return createServer(async (request, response) => {
    const method = (request.method ?? "GET").toUpperCase();
    const path = requestPath(request);
    const handler = routes[`${method} ${path}`];

    if (!handler) {
      const pathExists = Object.keys(routes).some((key) => key.endsWith(` ${path}`));
      if (pathExists) {
        writeJson(response, 405, { error: "method_not_allowed" });
      } else {
        writeJson(response, 404, { error: "not_found" });
      }
      return;
    }

    try {
      const result = await handler({ method, path, headers: request.headers });
      writeJson(response, result.status, result.body);
    } catch (error) {
      logger(`request ${method} ${path} failed: ${String(error)}`);
      writeJson(response, 500, { error: "internal_error" });
    }
  });
}

export interface RunningApiServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

/** Start listening, resolving once the socket is bound. */
export function startApiServer(
  options: ApiServerOptions & { port?: number; host?: string } = {},
): Promise<RunningApiServer> {
  const server = createApiServer(options);
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        server,
        port: boundPort,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
      });
    });
  });
}

/** Build routes for the REST API endpoints (M4.B02). */
export function buildApiRoutes(database: any): Routes {
  function getWorldId(request: ApiRequest): string {
    return request.headers["x-world-id"] as string || "w1";
  }

  return {
    "GET /world": (request) => {
      const worldId = getWorldId(request);
      const world = database.get(`SELECT * FROM worlds WHERE id = ?`, worldId);
      if (!world) {
        return { status: 404, body: { error: "world_not_found" } };
      }

      return {
        status: 200,
        body: {
          world: {
            id: world.id,
            currentTick: world.current_tick,
            season: world.season,
            weather: world.weather,
            nextDeadline: world.next_deadline,
          },
          players: [],
        },
      };
    },

    "GET /plot/:plotId": (request) => {
      const plotId = request.path.split("/").pop();

      const plot = database.get(
        `SELECT * FROM plots WHERE id = ?`,
        plotId,
      );
      if (!plot) {
        return { status: 404, body: { error: "plot_not_found" } };
      }

      return {
        status: 200,
        body: {
          plot: {
            id: plot.id,
            playerId: plot.player_id,
            regionId: plot.region_id,
            siteX: plot.site_x,
            siteY: plot.site_y,
            width: plot.width,
            height: plot.height,
            worldOwned: plot.world_owned,
          },
          buildings: [],
          inventory: [],
          ready: null,
        },
      };
    },

    "GET /player/:playerId/orders": (request) => {
      const playerId = request.path.split("/").pop();

      const orders = database.all(
        `SELECT * FROM orders WHERE player_id = ? AND status = 'queued'`,
        playerId,
      );

      return {
        status: 200,
        body: {
          orders: orders.map((o: any) => ({
            id: o.id,
            sequence: o.sequence,
            type: o.type,
            payload: JSON.parse(o.payload_json || "{}"),
            status: o.status,
            failureReason: o.failure_reason,
          })),
        },
      };
    },

    "GET /ready": () => ({
      status: 200,
      body: {
        ready: [],
        ownPosition: null,
      },
    }),

    "GET /barter": () => ({
      status: 200,
      body: {
        offers: [],
      },
    }),

    "GET /replay/latest": (request) => {
      const worldId = getWorldId(request);

      const latestTick = database.get(
        `SELECT tick FROM tick_logs WHERE world_id = ? ORDER BY tick DESC LIMIT 1`,
        worldId,
      )?.tick;

      if (!latestTick) {
        return { status: 404, body: { error: "no_replay_data" } };
      }

      const events = database.all(
        `SELECT tick, sequence, type, payload_json FROM archived_events WHERE world_id = ? AND tick = ? ORDER BY sequence`,
        worldId,
        latestTick,
      );

      return {
        status: 200,
        body: {
          tick: latestTick,
          header: {
            tick: latestTick,
            worldSeed: "seed",
            generatorVersion: "gen-1",
            contentVersion: "content-1",
            rulesVersion: "1.0.0",
          },
          events: events.map((e: any) => ({
            tick: e.tick,
            sequence: e.sequence,
            type: e.type,
            payload: JSON.parse(e.payload_json || "{}"),
          })),
        },
      };
    },

    "GET /push/subscriptions": () => ({
      status: 200,
      body: { subscriptions: [] },
    }),

    "POST /site": (request) => {
      const body = JSON.parse(
        request.body as string || '{"playerId":""}',
      ) as { playerId: string };

      const plot = database.get(
        `SELECT * FROM plots WHERE player_id = ? AND world_owned = 0`,
        body.playerId,
      );

      if (!plot) {
        return { status: 404, body: { error: "plot_not_found" } };
      }

      database.run(
        `UPDATE plots SET player_id = ? WHERE id = ?`,
        body.playerId,
        plot.id,
      );

      return {
        status: 200,
        body: {
          plotId: plot.id,
          message: "site_claimed_successfully",
        },
      };
    },

    "GET /players": () => ({
      status: 200,
      body: { players: [] },
    }),
  };
}