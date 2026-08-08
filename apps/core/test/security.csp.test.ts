// @gosleep/core — CSP + hardening header tests (GSL-269, target-architecture step 10).
//
// GSL-269 acceptance: every response carries `content-security-policy: default-src 'self'` in
// its LEADING directive (grep-friendly for smoke.sh), plus X-Content-Type-Options, X-Frame-Options,
// and Referrer-Policy. Middleware runs before the host + origin guards so REJECTIONS carry the
// same headers as successes — that closes the "attacker gets a 421 without CSP" gap.

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { applySecurityHeaders, CSP_HEADER_VALUE } from "../src/security/csp.ts";

function mkApp(): Hono {
  const app = new Hono();
  app.use("*", applySecurityHeaders);
  app.get("/ok", (c) => c.text("ok", 200));
  app.get("/fail", (c) => c.text("nope", 500));
  app.get("/json", (c) => c.json({ ok: true }));
  return app;
}

async function get(app: Hono, path: string): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`));
}

describe("applySecurityHeaders — CSP + hardening headers", () => {
  test("CSP header leads with default-src 'self' — smoke.sh greps for this exactly", () => {
    expect(CSP_HEADER_VALUE.startsWith("default-src 'self'")).toBe(true);
  });

  test("200 response carries CSP + nosniff + XFO + Referrer-Policy", async () => {
    const app = mkApp();
    const r = await get(app, "/ok");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toBe(CSP_HEADER_VALUE);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("5xx response ALSO carries the security headers (rejections don't leak)", async () => {
    const app = mkApp();
    const r = await get(app, "/fail");
    expect(r.status).toBe(500);
    expect(r.headers.get("content-security-policy")).toBe(CSP_HEADER_VALUE);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("JSON response also carries the headers (Content-Type does not shadow them)", async () => {
    const app = mkApp();
    const r = await get(app, "/json");
    expect(r.headers.get("content-security-policy")).toBe(CSP_HEADER_VALUE);
    expect(r.headers.get("content-type") ?? "").toMatch(/application\/json/i);
  });

  test("CSP contains frame-ancestors 'none' — the panel cannot be iframed", () => {
    expect(CSP_HEADER_VALUE).toContain("frame-ancestors 'none'");
  });

  test("CSP contains object-src 'none' — no <object>/<embed>/<applet>", () => {
    expect(CSP_HEADER_VALUE).toContain("object-src 'none'");
  });

  test("CSP does NOT contain unsafe-eval or unsafe-inline for scripts", () => {
    // Style still needs unsafe-inline (Tailwind/shadcn); scripts must not.
    expect(CSP_HEADER_VALUE).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(CSP_HEADER_VALUE).not.toContain("'unsafe-eval'");
  });
});
