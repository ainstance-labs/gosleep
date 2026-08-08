// @gosleep/core — Origin/Referer middleware tests (GSL-269, target-architecture step 10).
//
// CSRF guard. Covers:
//   - Safe methods (GET/HEAD/OPTIONS) bypass — the middleware only speaks to state-changing verbs.
//   - POST with a matching Origin → passes.
//   - POST with a matching Referer (Origin absent) → passes.
//   - POST with mismatched Origin/Referer → 403.
//   - POST with a cross-site Origin → 403.
//   - POST with neither header → 403.
//   - Origin spoofed to a scheme change (https://127.0.0.1:7331) → 403 (we serve http only).

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { HOST_HEADER } from "../src/config.ts";
import { requireLocalOrigin } from "../src/security/origin.ts";

const SELF = `http://${HOST_HEADER}`;

function mkApp(): Hono {
  const app = new Hono();
  app.use("*", requireLocalOrigin);
  app.get("/probe", (c) => c.text("ok-get", 200));
  app.post("/probe", (c) => c.text("ok-post", 200));
  return app;
}

async function post(
  app: Hono,
  headers: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/probe", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
}

describe("requireLocalOrigin — CSRF guard for POST + friends", () => {
  let app: Hono;
  beforeEach(() => {
    app = mkApp();
  });

  test("GET bypasses (safe method — Origin/Referer not required)", async () => {
    const r = await app.fetch(new Request("http://localhost/probe"));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok-get");
  });

  test("POST with matching Origin → passes", async () => {
    const r = await post(app, { origin: SELF });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok-post");
  });

  test("POST with matching Referer (Origin absent) → passes", async () => {
    const r = await post(app, { referer: `${SELF}/some/page` });
    expect(r.status).toBe(200);
  });

  test("POST with mismatched Origin vs Referer → 403", async () => {
    const r = await post(app, {
      origin: SELF,
      referer: "http://attacker.example/page",
    });
    expect(r.status).toBe(403);
  });

  test("POST with cross-site Origin → 403", async () => {
    const r = await post(app, { origin: "http://attacker.example" });
    expect(r.status).toBe(403);
  });

  test("POST with neither Origin nor Referer → 403", async () => {
    const r = await post(app, {});
    expect(r.status).toBe(403);
  });

  test("POST with https-scheme Origin (we serve http only) → 403", async () => {
    // A CSRF attempt from an https page loading our loopback URL: the Origin the browser sends
    // has scheme https, our SELF is http — the string compare in the middleware fails and we
    // reject cleanly rather than blindly accepting on Host+port equality.
    const r = await post(app, { origin: `https://${HOST_HEADER}` });
    expect(r.status).toBe(403);
  });

  test("POST with an unparseable Referer + valid Origin → passes on Origin alone", async () => {
    // originOf() returns null for a garbage Referer; the middleware falls back to Origin.
    // This is intentional: some browsers strip Referer under privacy mode, we must not
    // require both simultaneously.
    const r = await post(app, { origin: SELF, referer: "not-a-url" });
    expect(r.status).toBe(200);
  });
});
