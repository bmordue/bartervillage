import { afterEach, describe, expect, it } from "vitest";

import { checkCsrf, csrfCookie, guardCsrf, parseCookies, sessionCookie } from "../src/cookies.js";
import { startTestApi, type TestApi } from "./support/harness.js";

let harness: TestApi | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("session and CSRF cookies", () => {
  it("marks the session cookie HttpOnly, Secure and SameSite=Strict", () => {
    const cookie = sessionCookie("session-1", 60);

    expect(cookie).toContain("bv_session=session-1");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=60");
  });

  it("leaves the CSRF cookie readable by the client", () => {
    const cookie = csrfCookie("token-1");

    expect(cookie).toContain("bv_csrf=token-1");
    expect(cookie).not.toContain("HttpOnly");
  });

  it("parses multiple cookies", () => {
    expect(parseCookies("a=1; b=two=2; empty=")).toEqual({ a: "1", b: "two=2", empty: "" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("allows safe methods without a CSRF token", () => {
    expect(checkCsrf("GET", {})).toEqual({ ok: true });
    expect(checkCsrf("HEAD", {})).toEqual({ ok: true });
  });

  it("requires matching cookie and header tokens for mutations", () => {
    expect(checkCsrf("POST", {})).toEqual({
      ok: false,
      status: 403,
      body: { error: "csrf_failed" },
    });
    expect(checkCsrf("POST", { cookie: "bv_csrf=a", "x-csrf-token": "b" })).toEqual({
      ok: false,
      status: 403,
      body: { error: "csrf_failed" },
    });
    expect(checkCsrf("POST", { cookie: "bv_csrf=a", "x-csrf-token": "a" })).toEqual({ ok: true });
  });

  it("guards mutations over HTTP", async () => {
    harness = await startTestApi({
      buildRoutes: () => ({
        "POST /act": guardCsrf(() => ({ status: 200, body: { ok: true } })),
        "GET /read": guardCsrf(() => ({ status: 200, body: { ok: true } })),
      }),
    });

    const blocked = await fetch(`${harness.baseUrl}/act`, { method: "POST" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "csrf_failed" });

    const allowed = await fetch(`${harness.baseUrl}/act`, {
      method: "POST",
      headers: { cookie: "bv_csrf=token", "x-csrf-token": "token" },
    });
    expect(allowed.status).toBe(200);

    const safe = await fetch(`${harness.baseUrl}/read`);
    expect(safe.status).toBe(200);
  });
});
