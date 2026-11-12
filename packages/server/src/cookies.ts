/**
 * Session cookies and CSRF protection (spec §12; M4.B07).
 *
 * The session cookie is HttpOnly and SameSite=Strict. Mutations use the
 * double-submit pattern: a readable random `bv_csrf` cookie must match the
 * `x-csrf-token` header. Safe methods bypass the check.
 */

import type { RouteHandler } from "./api.js";

export const SESSION_COOKIE = "bv_session";
export const CSRF_COOKIE = "bv_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CookieOptions {
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
  maxAgeSeconds?: number;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`];
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.trunc(options.maxAgeSeconds))}`);
  }
  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${options.sameSite ?? "Strict"}`);
  if (options.secure ?? true) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function sessionCookie(sessionId: string, maxAgeSeconds = 30 * 24 * 60 * 60): string {
  return serializeCookie(SESSION_COOKIE, sessionId, { maxAgeSeconds });
}

export function csrfCookie(token: string, maxAgeSeconds = 30 * 24 * 60 * 60): string {
  return serializeCookie(CSRF_COOKIE, token, { httpOnly: false, maxAgeSeconds });
}

export type CsrfCheck = { ok: true } | { ok: false; status: 403; body: { error: string } };

export function checkCsrf(
  method: string,
  headers: { cookie?: string | undefined; "x-csrf-token"?: string | string[] | undefined },
): CsrfCheck {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return { ok: true };
  }
  const cookieToken = parseCookies(headers.cookie)[CSRF_COOKIE];
  const headerValue = headers[CSRF_HEADER];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return { ok: false, status: 403, body: { error: "csrf_failed" } };
  }
  return { ok: true };
}

export function guardCsrf(handler: RouteHandler): RouteHandler {
  return (request) => {
    const check = checkCsrf(request.method, request.headers);
    if (!check.ok) {
      return { status: check.status, body: check.body };
    }
    return handler(request);
  };
}
