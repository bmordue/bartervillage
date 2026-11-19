/**
 * Plain REST/JSON API process (spec §12; M4.B01).
 *
 * One Node HTTP server, no framework. Responses are JSON with `no-store` so the
 * polling client always sees current state. Feature endpoints are layered on in
 * M4.B02; this module owns transport concerns and the health route.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { content as bundledContent } from "@bartervillage/content";
import {
  currentBadge,
  ready as markReady,
  removeOrder,
  reorderQueue,
  unready,
  type Order,
  type OrderType,
} from "@bartervillage/rules";
import { createCredentialRoutes } from "./auth/credentialRoutes.js";
import { createDiscordRoutes } from "./auth/discordRoutes.js";
import type { DiscordAuth } from "./auth/discord.js";
import { createGithubRoutes } from "./auth/githubRoutes.js";
import type { GithubAuth } from "./auth/github.js";
import { createPasskeyRoutes } from "./auth/passkeyRoutes.js";
import type { PasskeyAuth } from "./auth/passkey.js";
import type { Database } from "./db/database.js";
import { loadWorldState, saveWorldState } from "./db/stateRepository.js";
import { checkMutationAllowed } from "./mutations.js";
import { listPushSubscriptions, subscribePush, unsubscribePush } from "./db/pushRepository.js";
import { validateOrderServerSide } from "./orderValidation.js";
import { DEFAULT_AUTH_RATE_LIMIT, RateLimiter, type RateLimitOptions } from "./rateLimit.js";
import { retryWorldTick } from "./retry.js";

export interface JsonResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string | string[]>;
}

export interface ApiRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  /** Peer address from the socket, used for per-client rate limiting. */
  remoteAddress?: string;
  body?: unknown;
  /** Query parameters parsed from the request URL. */
  query?: Record<string, string>;
  /** Path parameters captured from `:name` segments. */
  params?: Record<string, string>;
}

export type RouteHandler = (request: ApiRequest) => JsonResponse | Promise<JsonResponse>;

/** Routes keyed as `"METHOD /path"`. */
export type Routes = Record<string, RouteHandler>;

export interface ApiServerOptions {
  routes?: Routes;
  logger?: (message: string) => void;
}

export const POLL_INTERVAL_MS = 5000;

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  if (body === undefined) {
    response.writeHead(status, { "cache-control": "no-store", ...headers });
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(payload);
}

function requestPath(request: IncomingMessage): string {
  const url = request.url ?? "/";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function requestQuery(request: IncomingMessage): Record<string, string> {
  const url = request.url ?? "/";
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) {
    return {};
  }
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(url.slice(queryIndex + 1))) {
    query[key] = value;
  }
  return query;
}

function defaultRoutes(): Routes {
  return {
    "GET /health": () => ({ status: 200, body: { ok: true } }),
  };
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/** True when a `:param`-aware route path matches the concrete request path. */
function routePathMatches(routePath: string, path: string): boolean {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(path);
  if (routeSegments.length !== pathSegments.length) {
    return false;
  }
  return routeSegments.every(
    (segment, index) => segment.startsWith(":") || segment === pathSegments[index],
  );
}

interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

/** Resolve an exact route first, then fall back to `:param` patterns. */
function matchRoute(routes: Routes, method: string, path: string): RouteMatch | undefined {
  const exact = routes[`${method} ${path}`];
  if (exact) {
    return { handler: exact, params: {} };
  }
  const pathSegments = splitPath(path);
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = key.split(" ");
    if (routeMethod !== method || routePath === undefined) {
      continue;
    }
    if (!routePathMatches(routePath, path)) {
      continue;
    }
    const params: Record<string, string> = {};
    splitPath(routePath).forEach((segment, index) => {
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(pathSegments[index] ?? "");
      }
    });
    return { handler, params };
  }
  return undefined;
}

function readRequestBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const routes = options.routes ?? defaultRoutes();
  const logger = options.logger ?? (() => undefined);

  return createServer(async (request, response) => {
    const method = (request.method ?? "GET").toUpperCase();
    const path = requestPath(request);
    const match = matchRoute(routes, method, path);

    if (!match) {
      const pathExists = Object.entries(routes).some(([key]) => {
        const [routeMethod, routePath] = key.split(" ");
        return (
          routeMethod !== method && routePath !== undefined && routePathMatches(routePath, path)
        );
      });
      if (pathExists) {
        writeJson(response, 405, { error: "method_not_allowed" });
      } else {
        writeJson(response, 404, { error: "not_found" });
      }
      return;
    }

    try {
      const body = await readRequestBody(request);
      const result = await match.handler({
        method,
        path,
        headers: request.headers,
        ...(request.socket.remoteAddress === undefined
          ? {}
          : { remoteAddress: request.socket.remoteAddress }),
        params: match.params,
        query: requestQuery(request),
        body,
      });
      writeJson(response, result.status, result.body, result.headers);
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
type WorldStateRow = {
  id: string;
  current_tick: number;
  season: string;
  weather: string;
  next_deadline: string | null;
};

type PlotStateRow = {
  id: string;
  player_id: string | null;
  region_id: string;
  site_x: number;
  site_y: number;
  width: number;
  height: number;
  world_owned: number;
};

type QueuedOrderRow = {
  id: string;
  sequence: number;
  type: string;
  payload_json: string | null;
  status: string;
  failure_reason: string | null;
};

type InventoryRow = {
  item: string;
  quantity: number;
  locked: number;
};

type BuildingRow = {
  id: string;
  plot_id: string;
  type: string;
  level: number;
  construction_kind: string | null;
  construction_complete_tick: number | null;
};

type CropRow = {
  id: string;
  plot_id: string;
  tile_x: number;
  tile_y: number;
  type: string;
  planted_tick: number;
  growth_ticks: number;
  watered: number;
  tended: number;
  failed: number;
};

type AnimalRow = {
  id: string;
  plot_id: string;
  type: string;
  count: number;
  fed: number;
};

type BarterOfferRow = {
  id: string;
  poster_id: string;
  kind: string;
  gives_json: string;
  wants_json: string;
  quantity: number;
  created_at_tick: number;
  expiry_tick: number;
  status: string;
  parent_offer_id: string | null;
};

type PlayerStatusRow = {
  id: string;
  name: string;
  plot_id: string;
  energy: number;
};

type PlotInventoryRow = InventoryRow & {
  plot_id: string;
};

type ReadyRow = {
  tick: number;
  position: number;
};

type TickLogTickRow = { tick: number };

type LatestOrderTickRow = { tick: number | null };

type ArchivedEventRow = {
  tick: number;
  sequence: number;
  type: string;
  payload_json: string | null;
};

export interface BuildApiRoutesOptions {
  passkey?: PasskeyAuth;
  discord?: DiscordAuth;
  github?: GithubAuth;
  /** Override the per-client auth endpoint limit (spec §12; M4.B08). */
  authRateLimit?: RateLimitOptions;
}

function clientAddress(request: ApiRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedAddress = first?.split(",")[0]?.trim();
  if (forwardedAddress !== undefined && forwardedAddress.length > 0) {
    return forwardedAddress;
  }
  return request.remoteAddress ?? "unknown";
}

function rateLimitAuthRoutes(routes: Routes, options: RateLimitOptions): Routes {
  const limiter = new RateLimiter(options);
  for (const [key, handler] of Object.entries(routes)) {
    const [method, path] = key.split(" ");
    if (method === undefined || path === undefined || !path.startsWith("/auth/")) {
      continue;
    }
    routes[key] = (request) => {
      const result = limiter.check(clientAddress(request));
      if (!result.allowed) {
        return {
          status: 429,
          body: { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
          headers: { "retry-after": String(result.retryAfterSeconds) },
        };
      }
      return handler(request);
    };
  }
  return routes;
}

export function buildApiRoutes(database: Database, options: BuildApiRoutesOptions = {}): Routes {
  function getWorldId(request: ApiRequest): string {
    return (request.headers["x-world-id"] as string) || "w1";
  }

  function mutationBlocked(request: ApiRequest): JsonResponse | null {
    const check = checkMutationAllowed(database, getWorldId(request));
    return check.allowed ? null : { status: check.status, body: check.body };
  }

  const passkeyRoutes = options.passkey ? createPasskeyRoutes(database, options.passkey) : {};
  const discordRoutes = options.discord ? createDiscordRoutes(database, options.discord) : {};
  const githubRoutes = options.github ? createGithubRoutes(database, options.github) : {};
  const credentialRoutes = createCredentialRoutes(database);

  const routes: Routes = {
    ...passkeyRoutes,
    ...discordRoutes,
    ...githubRoutes,
    ...credentialRoutes,
    "GET /world": (request) => {
      const worldId = getWorldId(request);
      const world = database.get<WorldStateRow>(`SELECT * FROM worlds WHERE id = ?`, worldId);
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
      const plotId = request.path.split("/").pop() ?? "";

      const plot = database.get<PlotStateRow>(`SELECT * FROM plots WHERE id = ?`, plotId);
      if (!plot) {
        return { status: 404, body: { error: "plot_not_found" } };
      }

      const inventory = database
        .all<InventoryRow>(
          `SELECT item, quantity, locked FROM inventory WHERE plot_id = ? ORDER BY item`,
          plotId,
        )
        .map((row) => ({
          item: row.item,
          quantity: row.quantity,
          locked: row.locked,
          free: row.quantity - row.locked,
        }));

      const buildings = database.all<BuildingRow>(
        `SELECT id, plot_id, type, level, construction_kind, construction_complete_tick
         FROM buildings WHERE plot_id = ? ORDER BY type, id`,
        plotId,
      );
      const crops = database.all<CropRow>(
        `SELECT id, plot_id, tile_x, tile_y, type, planted_tick, growth_ticks,
                watered, tended, failed
         FROM crops WHERE plot_id = ? ORDER BY tile_y, tile_x`,
        plotId,
      );
      const animals = database.all<AnimalRow>(
        `SELECT id, plot_id, type, count, fed FROM animals WHERE plot_id = ? ORDER BY type, id`,
        plotId,
      );

      const storehouse = buildings.find((building) => building.type === "storehouse");
      const storehouseDefinition = bundledContent.buildings.find(
        (definition) => definition.id === "storehouse",
      );
      const storehouseLevel = storehouseDefinition?.levels.find(
        (level) => level.level === storehouse?.level,
      );
      const capacity = storehouseLevel?.storageCapacity ?? 0;
      const used = inventory.reduce((total, row) => total + row.quantity, 0);

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
          buildings: buildings.map((building) => ({
            id: building.id,
            plotId: building.plot_id,
            type: building.type,
            level: building.level,
            constructionKind: building.construction_kind,
            constructionCompleteTick: building.construction_complete_tick,
          })),
          crops: crops.map((crop) => ({
            id: crop.id,
            plotId: crop.plot_id,
            tileX: crop.tile_x,
            tileY: crop.tile_y,
            type: crop.type,
            plantedTick: crop.planted_tick,
            growthTicks: crop.growth_ticks,
            watered: crop.watered === 1,
            tended: crop.tended === 1,
            failed: crop.failed === 1,
          })),
          animals: animals.map((animal) => ({
            id: animal.id,
            plotId: animal.plot_id,
            type: animal.type,
            count: animal.count,
            fed: animal.fed === 1,
          })),
          storage: {
            capacity,
            used,
            free: Math.max(0, capacity - used),
          },
          inventory,
          ready: null,
        },
      };
    },

    "GET /player/:playerId/orders": (request) => {
      const playerId = request.params?.playerId ?? "";

      const orders = database.all<QueuedOrderRow>(
        `SELECT * FROM orders WHERE player_id = ? AND status = 'queued'
         ORDER BY sequence, id`,
        playerId,
      );

      return {
        status: 200,
        body: {
          orders: orders.map((o) => ({
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

    "GET /player/:playerId/order-failures": (request) => {
      const playerId = request.params?.playerId ?? "";
      const latest = database.get<LatestOrderTickRow>(
        `SELECT MAX(tick) AS tick FROM orders WHERE player_id = ? AND status = 'failed'`,
        playerId,
      );
      if (!latest || latest.tick === null) {
        return { status: 200, body: { tick: null, failures: [] } };
      }

      const failures = database.all<QueuedOrderRow>(
        `SELECT * FROM orders
         WHERE player_id = ? AND status = 'failed' AND tick = ?
         ORDER BY sequence, id`,
        playerId,
        latest.tick,
      );

      return {
        status: 200,
        body: {
          tick: latest.tick,
          failures: failures.map((order) => ({
            id: order.id,
            sequence: order.sequence,
            type: order.type,
            payload: JSON.parse(order.payload_json || "{}"),
            status: order.status,
            failureReason: order.failure_reason,
          })),
        },
      };
    },

    "GET /player/:playerId": (request) => {
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";

      const player = database.get<PlayerStatusRow>(
        `SELECT id, name, plot_id, energy FROM players WHERE id = ?`,
        playerId,
      );
      if (!player) {
        return { status: 404, body: { error: "player_not_found" } };
      }

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }

      const goodwillEntry = state.goodwill.find((entry) => entry.playerId === playerId);
      const goodwillScore = goodwillEntry?.score ?? 0;
      const badge = currentBadge(goodwillScore, bundledContent.goodwill);

      const world = state.world;
      const ready = database.get<ReadyRow>(
        `SELECT tick, position FROM ready WHERE player_id = ? AND tick = ?`,
        playerId,
        world.currentTick,
      );

      return {
        status: 200,
        body: {
          player: {
            id: player.id,
            name: player.name,
            plotId: player.plot_id,
            energy: player.energy,
            goodwill: goodwillScore,
            badge: badge?.id ?? null,
            badgeName: badge?.name ?? null,
          },
          ready: ready ?? null,
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

    "PUT /player/:playerId/ready": (request) => {
      const blocked = mutationBlocked(request);
      if (blocked) {
        return blocked;
      }
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";
      const body = JSON.parse((request.body as string) || "{}") as { ready?: unknown };
      if (typeof body.ready !== "boolean") {
        return { status: 400, body: { error: "invalid_ready_state" } };
      }

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }
      if (!state.players.some((player) => player.id === playerId)) {
        return { status: 404, body: { error: "player_not_found" } };
      }

      const tick = state.world.currentTick;
      const entry = body.ready ? markReady(state, playerId, tick) : null;
      if (!body.ready) {
        unready(state, playerId, tick);
      }
      saveWorldState(database, state);
      return { status: 200, body: { ready: entry } };
    },

    "GET /barter": () => {
      const players = database.all<PlayerStatusRow>(
        `SELECT id, name, plot_id, energy FROM players`,
      );
      const plotByPlayer = new Map(players.map((player) => [player.id, player.plot_id]));
      const nameByPlayer = new Map(players.map((player) => [player.id, player.name]));

      const inventory = database.all<PlotInventoryRow>(
        `SELECT plot_id, item, quantity, locked FROM inventory`,
      );
      const freeStockByPlot = new Map<string, Map<string, number>>();
      for (const row of inventory) {
        let stock = freeStockByPlot.get(row.plot_id);
        if (!stock) {
          stock = new Map<string, number>();
          freeStockByPlot.set(row.plot_id, stock);
        }
        stock.set(row.item, row.quantity - row.locked);
      }

      const offers = database
        .all<BarterOfferRow>(
          `SELECT id, poster_id, kind, gives_json, wants_json, quantity,
                  created_at_tick, expiry_tick, status, parent_offer_id
           FROM offers
           WHERE status = 'open'
           ORDER BY created_at_tick, id`,
        )
        .map((row) => {
          const gives = JSON.parse(row.gives_json) as { item: string; quantity: number }[];
          const wants = JSON.parse(row.wants_json) as { item: string; quantity: number }[];
          const stock =
            freeStockByPlot.get(plotByPlayer.get(row.poster_id) ?? "") ?? new Map<string, number>();
          const items = [...new Set([...gives, ...wants].map((stack) => stack.item))].sort();
          return {
            id: row.id,
            posterId: row.poster_id,
            posterName: nameByPlayer.get(row.poster_id) ?? row.poster_id,
            kind: row.kind,
            gives,
            wants,
            quantity: row.quantity,
            createdAtTick: row.created_at_tick,
            expiryTick: row.expiry_tick,
            status: row.status,
            parentOfferId: row.parent_offer_id,
            posterFreeStock: items.map((item) => ({ item, free: stock.get(item) ?? 0 })),
          };
        });

      return {
        status: 200,
        body: { offers },
      };
    },

    "GET /replay/latest": (request) => {
      const worldId = getWorldId(request);

      const latestTick = database.get<TickLogTickRow>(
        `SELECT tick FROM tick_logs WHERE world_id = ? ORDER BY tick DESC LIMIT 1`,
        worldId,
      )?.tick;

      if (latestTick === undefined) {
        return { status: 404, body: { error: "no_replay_data" } };
      }

      const events = database.all<ArchivedEventRow>(
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
          events: events.map((e) => ({
            tick: e.tick,
            sequence: e.sequence,
            type: e.type,
            payload: JSON.parse(e.payload_json || "{}"),
          })),
        },
      };
    },

    "GET /vapid-key": () => {
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      if (!publicKey) {
        return { status: 503, body: { error: "vapid_key_not_configured" } };
      }
      return { status: 200, body: { publicKey } };
    },

    "GET /push/subscriptions": (request) => {
      const playerId = request.query?.playerId ?? undefined;
      if (playerId) {
        const subs = listPushSubscriptions(database, playerId);
        return {
          status: 200,
          body: {
            subscriptions: subs.map((s) => ({
              endpoint: s.endpoint,
              p256dh: s.p256dh,
              auth: s.auth,
            })),
          },
        };
      }
      return { status: 200, body: { subscriptions: [] } };
    },

    "POST /push/subscriptions": (request) => {
      const body = JSON.parse((request.body as string) || "{}") as Record<string, unknown>;
      const playerId =
        (body.playerId as string | undefined) ?? (request.query?.playerId as string | undefined);
      if (!body.endpoint || typeof body.endpoint !== "string") {
        return { status: 400, body: { error: "missing_endpoint" } };
      }
      subscribePush(
        database,
        playerId ?? "p1",
        body.endpoint as string,
        (body.keys as { p256dh?: string })?.p256dh ?? "",
        (body.keys as { auth?: string })?.auth ?? "",
      );
      return { status: 201, body: { ok: true } };
    },

    "DELETE /push/subscriptions": (request) => {
      const body = JSON.parse((request.body as string) || "{}") as Record<string, unknown>;
      const playerId =
        (body.playerId as string | undefined) ?? (request.query?.playerId as string | undefined);
      if (!body.endpoint || typeof body.endpoint !== "string") {
        return { status: 400, body: { error: "missing_endpoint" } };
      }
      unsubscribePush(database, playerId ?? "p1", body.endpoint as string);
      return { status: 200, body: { ok: true } };
    },

    "POST /site": (request) => {
      const body = JSON.parse((request.body as string) || '{"playerId":""}') as {
        playerId: string;
      };

      const plot = database.get<PlotStateRow>(
        `SELECT * FROM plots WHERE player_id = ? AND world_owned = 0`,
        body.playerId,
      );

      if (!plot) {
        return { status: 404, body: { error: "plot_not_found" } };
      }

      database.run(`UPDATE plots SET player_id = ? WHERE id = ?`, body.playerId, plot.id);

      return {
        status: 200,
        body: {
          plotId: plot.id,
          message: "site_claimed_successfully",
        },
      };
    },

    "GET /players": () => {
      const players = database.all<PlayerStatusRow>(
        `SELECT id, name, plot_id, energy FROM players ORDER BY name, id`,
      );

      return {
        status: 200,
        body: {
          players: players.map((player) => ({
            id: player.id,
            name: player.name,
            plotId: player.plot_id,
            energy: player.energy,
          })),
        },
      };
    },

    "POST /player/:playerId/orders": (request) => {
      const blocked = mutationBlocked(request);
      if (blocked) {
        return blocked;
      }
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";
      const body = JSON.parse((request.body as string) || "{}") as {
        type: string;
        payload: Record<string, unknown>;
        sequence?: number;
      };

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }

      // Find the player
      const player = state.players.find((p) => p.id === playerId);
      if (!player) {
        return { status: 404, body: { error: "player_not_found" } };
      }

      // Assign tick and sequence
      const tick = state.world.currentTick;
      const sequence = body.sequence ?? state.nextOrderSequence;

      const order = {
        id: `order-${playerId}-${tick}-${sequence}`,
        playerId,
        tick,
        sequence,
        type: body.type as OrderType,
        payload: body.payload,
        status: "queued" as const,
        failureReason: null,
      } as Order;

      const validation = validateOrderServerSide(state, bundledContent, order);
      if (!validation.ok) {
        return { status: 400, body: { error: validation.reason } };
      }

      // Persist order
      database.run(
        `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        order.id,
        order.playerId,
        order.tick,
        order.sequence,
        order.type,
        JSON.stringify(order.payload),
        order.status,
        order.failureReason,
      );

      return {
        status: 201,
        body: { order: { id: order.id, sequence: order.sequence } },
      };
    },

    "POST /player/:playerId/orders/batch": (request) => {
      const blocked = mutationBlocked(request);
      if (blocked) {
        return blocked;
      }
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";
      const body = JSON.parse((request.body as string) || "{}") as { orders?: unknown };
      if (!Array.isArray(body.orders) || body.orders.length === 0 || body.orders.length > 144) {
        return { status: 400, body: { error: "invalid_orders" } };
      }

      const drafts: { type: OrderType; payload: Record<string, unknown> }[] = [];
      for (const entry of body.orders) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return { status: 400, body: { error: "invalid_orders" } };
        }
        const draft = entry as { type?: unknown; payload?: unknown };
        if (
          typeof draft.type !== "string" ||
          typeof draft.payload !== "object" ||
          draft.payload === null ||
          Array.isArray(draft.payload)
        ) {
          return { status: 400, body: { error: "invalid_orders" } };
        }
        drafts.push({
          type: draft.type as OrderType,
          payload: draft.payload as Record<string, unknown>,
        });
      }

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }
      if (!state.players.some((player) => player.id === playerId)) {
        return { status: 404, body: { error: "player_not_found" } };
      }

      const tick = state.world.currentTick;
      const orders = drafts.map((draft, index) => {
        const sequence = state.nextOrderSequence + index;
        return {
          id: `order-${playerId}-${tick}-${sequence}`,
          playerId,
          tick,
          sequence,
          type: draft.type,
          payload: draft.payload,
          status: "queued" as const,
          failureReason: null,
        } as Order;
      });

      for (const order of orders) {
        const validation = validateOrderServerSide(state, bundledContent, order);
        if (!validation.ok) {
          return { status: 400, body: { error: validation.reason } };
        }
      }

      database.transaction(() => {
        for (const order of orders) {
          database.run(
            `INSERT INTO orders (id, player_id, tick, sequence, type, payload_json, status, failure_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            order.id,
            order.playerId,
            order.tick,
            order.sequence,
            order.type,
            JSON.stringify(order.payload),
            order.status,
            order.failureReason,
          );
        }
      });

      return {
        status: 201,
        body: {
          orders: orders.map((order) => ({ id: order.id, sequence: order.sequence })),
        },
      };
    },

    "PUT /player/:playerId/orders": (request) => {
      const blocked = mutationBlocked(request);
      if (blocked) {
        return blocked;
      }
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";
      const body = JSON.parse((request.body as string) || "{}") as {
        orderIds?: unknown;
      };
      if (!Array.isArray(body.orderIds) || body.orderIds.some((id) => typeof id !== "string")) {
        return { status: 400, body: { error: "invalid_order_ids" } };
      }

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }
      if (!state.players.some((player) => player.id === playerId)) {
        return { status: 404, body: { error: "player_not_found" } };
      }

      try {
        reorderQueue(state, playerId, state.world.currentTick, body.orderIds);
      } catch (error) {
        return {
          status: 400,
          body: { error: "invalid_queue", message: String(error) },
        };
      }
      saveWorldState(database, state);
      return { status: 200, body: { ok: true } };
    },

    "DELETE /player/:playerId/orders/:orderId": (request) => {
      const blocked = mutationBlocked(request);
      if (blocked) {
        return blocked;
      }
      const worldId = getWorldId(request);
      const playerId = request.params?.playerId ?? "";
      const orderId = request.params?.orderId ?? "";

      const state = loadWorldState(database, worldId);
      if (!state) {
        return { status: 404, body: { error: "world_not_found" } };
      }
      const order = state.orders.find((candidate) => candidate.id === orderId);
      if (!order || order.playerId !== playerId) {
        return { status: 404, body: { error: "order_not_found" } };
      }
      if (order.status !== "queued") {
        return { status: 409, body: { error: "order_not_queued" } };
      }
      if (!removeOrder(state, orderId)) {
        return { status: 409, body: { error: "order_not_queued" } };
      }
      saveWorldState(database, state);
      return { status: 200, body: { ok: true, orderId } };
    },

    "POST /world/:worldId/ticks/:tick/retry": (request) => {
      const worldId = request.params?.worldId ?? getWorldId(request);
      const requestedTick = Number.parseInt(request.params?.tick ?? "", 10);
      if (!Number.isFinite(requestedTick)) {
        return { status: 400, body: { error: "invalid_tick" } };
      }
      const result = retryWorldTick(database, worldId, requestedTick);
      if (result.success) {
        return {
          status: 200,
          body: { ok: true, tick: result.tick, stateHash: result.stateHash },
        };
      }
      const status =
        result.error === "world_not_found" ? 404 : result.error === "tick_mismatch" ? 400 : 409;
      return { status, body: { error: result.error ?? "retry_failed", tick: result.tick } };
    },
  };

  return rateLimitAuthRoutes(routes, options.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT);
}
