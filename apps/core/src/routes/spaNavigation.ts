// @gosleep/core — SPA browser-navigation guard (GSL-310).
//
// Problem
// -------
// The read-route table (`readRoutes` in `routes/read.ts`) defines Bearer-gated GET handlers
// for /fleet, /timeline, /questions, /tasks, /cost — five names that ALSO happen to be
// client-side routes in the React SPA. Because Hono checks mounts in order and this app
// registers `readRoutes` BEFORE `spaRoutes`, a browser hard-reload of `/questions` walks
// straight into the JSON handler, fails the Bearer check, and returns 401 with body
// "unauthorized" — the SPA never boots.
//
// Only `/overview` used to escape because no API happens to share that name. Every other
// client route was a broken bookmark.
//
// Fix
// ---
// A middleware mounted BEFORE `readRoutes`. For a request to be a browser navigation:
//   * method must be GET or HEAD (an XHR that happened to be GET can still pass, see below),
//   * path must be one of the known collision paths (or a nested one — a future
//     `/questions/GSL-123` client route would also 401),
//   * `Accept` header must PREFER text/html over application/json.
//
// Browsers send `Accept: text/html, application/xhtml+xml, image/*, ...; q=0.9`. The SDK's
// fetch calls set `Accept: application/json`. So the negotiation cleanly separates the two
// classes of caller — no cookie / user-agent guessing.
//
// When those conditions hold, the guard serves index.html verbatim (same body the SPA
// fallback in `routes/spa.ts` would return for an unknown path). Any XHR / SDK / curl call
// with `Accept: application/json` falls through to the read route with its Bearer requirement
// intact.

import { Hono } from "hono";
import { serveSpaFallback } from "./spa.ts";

/**
 * The exact paths that both the API read-route table AND the React SPA client-router
 * define. Everything not in this set either:
 *   * belongs uniquely to the API (e.g. `/status`, `/version`), or
 *   * belongs uniquely to the SPA and already falls through to `spaRoutes` cleanly.
 *
 * Nested children (e.g. `/questions/GSL-123`) are covered by prefix — the SPA screen owns
 * the child path client-side, and the read handler does not define it at all.
 */
const CLIENT_ROUTE_PREFIXES: readonly string[] = [
  "/fleet",
  "/timeline",
  "/questions",
  "/tasks",
  "/cost",
  "/overview",
  "/skills",
];

/**
 * Parses `Accept` and decides whether the caller prefers HTML over JSON. A missing header
 * means "no strong preference" — we DO NOT serve the SPA for a bare fetch() (which sends no
 * Accept at all in some environments) because that would break the read-only API's
 * long-standing behavior for anyone hitting `/questions` from curl.
 *
 * The heuristic is deliberately simple: if `text/html` appears BEFORE `application/json`
 * (or the header is a browser-shaped `text/html,application/xhtml+xml,...`), route to HTML.
 * If `application/json` appears at all in the header without a preceding `text/html`, treat
 * as an API call.
 *
 * Wildcard `star/star` alone is treated as an API call for backward compatibility.
 */
export function acceptPrefersHtml(acceptHeader: string | null): boolean {
  if (acceptHeader === null) return false;
  // Strip whitespace and lowercase for the scan.
  const raw = acceptHeader.toLowerCase();
  const htmlIdx = raw.indexOf("text/html");
  if (htmlIdx < 0) return false;
  const jsonIdx = raw.indexOf("application/json");
  // If JSON is present and appears BEFORE HTML in the list, the caller prefers JSON.
  if (jsonIdx >= 0 && jsonIdx < htmlIdx) return false;
  return true;
}

/**
 * True when the request's path is a client-router owned SPA route. Nested paths (e.g.
 * `/questions/GSL-123`) also match — the SPA renders the same shell and the router
 * dispatches the child.
 */
export function isClientRoutePath(pathname: string): boolean {
  if (pathname === "/") return true;
  for (const prefix of CLIENT_ROUTE_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * True when the request is a browser navigation to a client-side SPA route that would
 * otherwise be shadowed by a same-named JSON API handler.
 */
export function isBrowserSpaNavigation(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const url = new URL(req.url);
  if (!isClientRoutePath(url.pathname)) return false;
  return acceptPrefersHtml(req.headers.get("accept"));
}

/**
 * Mount the guard as a single-router Hono app. The wrapper is convenient because Hono's
 * `app.route("/", …)` API expects a Hono instance, and this way the ordering commitment
 * (mount BEFORE `readRoutes`) is co-located with the collision-path list.
 */
export const spaNavigationRoutes = new Hono();

spaNavigationRoutes.use("*", async (c, next) => {
  if (!isBrowserSpaNavigation(c.req.raw)) {
    return next();
  }
  // Browser reload of /fleet, /questions, … — return the SPA shell so the client router
  // can render the correct screen. `serveSpaFallback` also handles the "web bundle missing"
  // placeholder path, so a fresh clone still gets a helpful page instead of a mystery 401.
  c.res = await serveSpaFallback();
});
