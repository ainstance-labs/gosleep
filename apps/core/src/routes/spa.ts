// @gosleep/core — SPA static-serve routes (GSL-285).
//
// Serves the built React client from `apps/web/dist/`. Wired into serve.ts LAST, after every
// API/SSE/actions/internal route mount, so:
//
//   * Any request matching a JSON/SSE endpoint (`/healthz`, `/status`, `/events`, `/fleet`, …)
//     is answered by that route as before — this file never sees it.
//   * A request for a static asset (`/assets/index-XYZ.js`, `/favicon.ico`, `/manifest.webmanifest`,
//     …) is answered from the `apps/web/dist/` tree.
//   * A request for a client-side route (`/`, `/overview`, `/fleet`, `/questions`, `/setup`, …)
//     falls through to the SPA fallback: `index.html`. react-router's `createBrowserRouter`
//     then renders the correct screen client-side.
//
// FIT WITH THE MIDDLEWARE STACK. `applySecurityHeaders` runs first at the app level, so every
// response — static asset, index.html, or 404 — still carries CSP + nosniff + XFO. `requireLocalHost`
// still enforces the Host header. `requireLocalOrigin` bypasses safe methods (GET), so a browser
// hitting `http://127.0.0.1:7331/overview` walks through cleanly.
//
// AUTH POLICY. Static assets are PUBLIC (no Bearer) — same posture the Vite dev server + any
// SPA host takes. The SPA JS then walks the /setup handshake or reads sessionStorage to acquire
// a Bearer for the API calls. This is safe because:
//   * The bind is loopback-only (127.0.0.1) + Host-header check — no remote reader can reach it.
//   * `index.html` and the JS bundle carry no secrets — the token is not in the built output.
//   * All /status /fleet /events etc. still require Bearer, so an unauth browser sees the
//     shell but every data call 401s (which the SPA already surfaces as "Auth required").
//
// DIST LOCATION. The Vite build writes to `apps/web/dist/` at repo root (per apps/web/vite.config.ts).
// We resolve it relative to the core process's cwd (the repo root when launchd or `bun run --filter`
// starts core) with an env override (`GOSLEEP_WEB_DIST`) so a hermetic smoke can point at a fixture.
//
// FALLBACK CONTRACT. A GET whose path does not resolve to a file under the dist root returns
// `index.html` verbatim (SPA fallback). Everything non-GET (POST/PUT/…) 404s honestly — an SPA
// fallback for POST would mask a real client bug.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const spaRoutes = new Hono();

/**
 * Resolve the absolute path to the built web bundle. Env override wins so a hermetic smoke
 * can point at a scratch dist without moving the real one. If the resolved path does not
 * exist we return null and the caller mounts a "SPA not built" placeholder — the panel is
 * still reachable, the message is honest.
 */
export function resolveWebDistRoot(): string | null {
  const override = process.env.GOSLEEP_WEB_DIST;
  const candidates: string[] = [];
  if (override !== undefined && override.length > 0) {
    candidates.push(resolve(override));
  } else {
    // Default: repo-root-relative `apps/web/dist`. `process.cwd()` is the repo root under
    // launchd (WorkingDirectory in the plist) and under `bun run --filter='@gosleep/core' start`.
    candidates.push(resolve(process.cwd(), "apps/web/dist"));
    // Fallback for when a smoke boots serve.ts directly from apps/core/ as the cwd.
    candidates.push(resolve(process.cwd(), "../web/dist"));
    // Fallback for when a smoke boots serve.ts with apps/core/src as the cwd (very unusual).
    candidates.push(resolve(process.cwd(), "../../../apps/web/dist"));
  }
  for (const p of candidates) {
    try {
      if (existsSync(p) && statSync(p).isDirectory()) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

const WEB_DIST_ROOT = resolveWebDistRoot();

/**
 * Placeholder HTML returned when the web bundle is not present (fresh clone before
 * `bun run --filter='@gosleep/web' build`, or a broken deploy). Explicit is better than
 * a blank page — the owner reads it and knows what to run.
 */
function placeholderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>gosleep — control plane (bundle missing)</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #fafafa; color: #26272b;
           margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { max-width: 640px; padding: 32px; }
    code { font-family: ui-monospace, Menlo, monospace; background: #f2f3f5;
           padding: 2px 6px; border-radius: 4px; }
    .muted { color: #6b6f78; margin-top: 8px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b0b0d; color: #e4e5e8; }
      code { background: #1b1c20; }
      .muted { color: #a4a7ad; }
    }
  </style>
</head>
<body>
  <main>
    <h1>gosleep-core is up, but the web bundle is missing.</h1>
    <p>Build the SPA before the owner opens this URL:</p>
    <p><code>bun run --filter='@gosleep/web' build</code></p>
    <p class="muted">API endpoints (<code>/healthz</code>, <code>/status</code>, <code>/version</code>, …)
    remain reachable. This placeholder is served by <code>apps/core/src/routes/spa.ts</code>.</p>
  </main>
</body>
</html>`;
}

/**
 * The SPA fallback: when no static file matched under dist, return index.html so react-router
 * can render the requested client-side route. Reads index.html lazily on every hit; the file is
 * <1 KB gzipped and the OS page cache does the heavy lifting. Explicit ONLY on GET — a POST or
 * PUT to an unknown path is a real 404, not a mis-routed SPA nav.
 *
 * Exported (GSL-310) so the SPA-navigation guard mounted BEFORE the API read routes can reuse
 * the exact same body when it intercepts a browser reload of /fleet, /questions, etc.
 */
export async function serveSpaFallback(): Promise<Response> {
  if (WEB_DIST_ROOT === null) {
    return new Response(placeholderHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const indexPath = resolve(WEB_DIST_ROOT, "index.html");
  try {
    const body = await readFile(indexPath, "utf8");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The bundle name is a content hash so it can cache forever; the shell must not.
        "cache-control": "no-cache",
      },
    });
  } catch {
    return new Response(placeholderHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

// -----------------------------------------------------------------------------
// mounts
// -----------------------------------------------------------------------------
//
// serveStatic tries to answer GET requests from files in the dist root. When it finds nothing,
// its `onNotFound` handler fires — we swap in the SPA fallback so an unknown path lands on
// index.html (react-router owns it from there). Non-GET falls through to the final 404 handler.

if (WEB_DIST_ROOT !== null) {
  spaRoutes.get(
    "*",
    serveStatic({
      root: WEB_DIST_ROOT,
      // The Hono bun serveStatic strips the leading '/' and looks up `<root>/<path>`. That gives
      // us `apps/web/dist/assets/index-XYZ.js` etc. verbatim.
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
      onNotFound: async (_path, c) => {
        // Only fall through to the SPA on GET. HEAD is safe too (same target). Anything else
        // is a real 404 — a POST to /nope should NOT rewrite to index.html.
        const method = c.req.method.toUpperCase();
        if (method === "GET" || method === "HEAD") {
          const res = await serveSpaFallback();
          // Copy the fallback into the current response so onNotFound's return-void contract
          // still delivers the body. Hono lets us set `c.res` directly.
          c.res = res;
        }
      },
    }),
  );
} else {
  // Bundle missing entirely — placeholder for every GET / and any child. Non-GET still 404s
  // from the outer app.
  spaRoutes.get("*", async (c) => {
    if (c.req.method.toUpperCase() !== "GET" && c.req.method.toUpperCase() !== "HEAD") {
      return c.text("not found", 404);
    }
    const html = placeholderHtml();
    return c.body(html, 200, { "content-type": "text/html; charset=utf-8" });
  });
}
