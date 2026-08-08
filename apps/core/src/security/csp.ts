// @gosleep/core — Content-Security-Policy middleware (GSL-269, target-architecture step 10).
//
// Stamps a strict CSP on every response leaving the server. The client is loopback-only React
// served by Vite / built into a static bundle, and the SSE stream is same-origin — no third
// party asset lives here. So the policy is the smallest one that still lets the client work:
//
//   default-src 'self'            — every fetch default (scripts, styles, images, workers, …)
//                                    resolves only against 127.0.0.1:7331.
//   connect-src 'self'            — XHR/fetch/EventSource including the /events SSE stream.
//   img-src 'self' data:          — small inline PNGs (favicon, error-page icon) travel as
//                                    data: URIs; keeping this explicit avoids a re-review the
//                                    day someone tries to add one.
//   style-src 'self' 'unsafe-inline'
//                                 — Vite's dev server + shadcn's Tailwind pipeline emit inline
//                                    <style> tags; a stricter policy would break every screen
//                                    behind /apps/web. Script inlines get `strict-dynamic` under
//                                    a future nonce swap; unsafe-inline for STYLES only is
//                                    baseline advice for React/Vite loopback apps.
//   script-src 'self'             — no inline scripts. Bundles are served from same-origin.
//   object-src 'none'             — no <object>/<embed>/<applet>.
//   base-uri 'self'               — a <base> tag cannot redirect same-origin URLs off-host.
//   form-action 'self'            — <form action="…"> stays same-origin.
//   frame-ancestors 'none'        — the panel cannot be iframed. (Equivalent to X-Frame-Options
//                                    DENY, in the modern header.)
//
// Also stamps two related hardening headers per the target-architecture red team:
//   X-Content-Type-Options: nosniff        — matches GitHub's raw-content behaviour, prevents
//                                            MIME sniffing from opening a script-injection door.
//   Referrer-Policy: no-referrer           — every outgoing link (there aren't any today, but
//                                            the client may add one) omits the URL.
//
// GSL-269 acceptance: `curl -I http://127.0.0.1:7331/` MUST contain
// `content-security-policy: default-src 'self'`.
//
// FRAME-ANCESTORS SUBTLETY. The X-Frame-Options header pre-dates CSP and is IGNORED when
// frame-ancestors is set on a same-response CSP. The two co-exist here (both `frame-ancestors
// 'none'` and `X-Frame-Options: DENY`) only because some old smoke/curl setups grep for XFO.
// Removing XFO is safe once the tooling is refreshed.

import type { MiddlewareHandler } from "hono";

// Ordering: alphabetise directives EXCEPT default-src first — the smoke assertion greps for
// "content-security-policy: default-src 'self'" and pinning the head keeps that grep tight.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
];

export const CSP_HEADER_VALUE = CSP_DIRECTIVES.join("; ");

export const applySecurityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // Stamp AFTER next() so route handlers cannot accidentally remove the header. Hono keeps a
  // Headers instance per response; a plain `c.header(...)` before next() would be blown away
  // by `c.text()` / `c.json()` that reset headers on the returned Response.
  c.res.headers.set("content-security-policy", CSP_HEADER_VALUE);
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("x-frame-options", "DENY");
  c.res.headers.set("referrer-policy", "no-referrer");
};
