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
