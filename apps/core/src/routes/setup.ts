// @gosleep/core — /setup route (GSL-291): browser-native Bearer discovery for the SPA.
//
// The problem this fixes: opening `http://127.0.0.1:7331/` in Safari sees the SPA shell
// but every data call 401s because the browser has no Bearer. The pre-291 flow required
// the owner to hand-inject the Bearer into `sessionStorage` via devtools — a step
// impossible from mobile Safari and unfriendly from any browser.
//
// The flow (target-architecture rev 2 §3.3):
//
//   1. `bash apps/core/plist.sh setup-url` calls `POST /internal/setup/otp` (see
//      `apps/core/src/routes/internal.ts`) with the internal secret. Core generates
//      a one-shot OTP with a 5-min TTL, stores its SHA-256 in memory, returns the URL
//      `http://127.0.0.1:7331/setup?tok=<OTP>`.
//   2. Owner pastes the URL into their browser (or scans a QR of it from another
//      device — that's a v2 flourish, out of scope here).
//   3. `GET /setup?tok=<OTP>` validates the OTP (single-use, TTL-bounded), reads the
//      Bearer via `resolveAuthSource()` (dev-env → Keychain → token-file), and returns
//      the SPA's `index.html` with an extra `<meta name="gosleep-token" content="<Bearer>">`
//      injected in <head>. The SPA's boot code reads the meta into `sessionStorage`
//      and removes the tag before the first render — so the Bearer never lands in
//      browser history and never survives a page inspect.
//
// The Bearer travels through the DOM (not the URL) so:
//   - The URL bar / history entry carries only the OTP, not the Bearer.
//   - `Referer` (blocked by our `Referrer-Policy: no-referrer` anyway) never leaks.
//   - A refresh of the resulting page does NOT re-trigger the setup flow (the OTP is
//     used); the owner needs a fresh URL. This is the intent.
//
// CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'` — we ship no inline
// scripts here. The meta tag is CSP-neutral (data, not script). The SPA's own JS
// (`/assets/index-*.js`) reads it.

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { otpStore } from "../setup/otp-store.ts";
import { resolveAuthSource } from "../security/authSource.ts";
import { resolveWebDistRoot } from "./spa.ts";

export const setupRoutes = new Hono();

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/**
 * Escape a string for safe insertion into an HTML attribute. Bearers can legally contain
 * characters that would break the attribute (`"` most notably), so we go through the
 * canonical set: & < > " '.
 */
function escapeHtmlAttr(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Load the SPA index.html + splice a `<meta name="gosleep-token" content="…">` into <head>.
 * On any read failure returns null; the caller then renders the "setup unavailable" fallback.
 */
async function renderBootstrapHtml(bearer: string): Promise<string | null> {
  const root = resolveWebDistRoot();
  if (root === null) return null;
  let body: string;
  try {
    body = await readFile(resolve(root, "index.html"), "utf8");
  } catch {
    return null;
  }
  const meta = `<meta name="gosleep-token" content="${escapeHtmlAttr(bearer)}">`;
  // Splice inside <head> so it lives before the bundle script runs. Fall back to prepending
  // the whole body if <head> is missing (should never happen — Vite's index.html has one).
  if (body.includes("</head>")) {
    return body.replace("</head>", `  ${meta}\n  </head>`);
  }
  return `${meta}\n${body}`;
}

/** Diagnostic page for a bad/expired/used OTP. Plain HTML, no JS. */
function renderSetupError(reason: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>gosleep — setup ${escapeHtmlAttr(reason)}</title>
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
    <h1>Setup link ${escapeHtmlAttr(reason)}</h1>
    <p>${escapeHtmlAttr(detail)}</p>
    <p>Generate a fresh setup URL on the host:</p>
    <p><code>bash apps/core/plist.sh setup-url</code></p>
    <p class="muted">Each setup link is single-use and expires 5 minutes after it is issued.</p>
  </main>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// GET /setup
// -----------------------------------------------------------------------------

setupRoutes.get("/setup", async (c) => {
  const tok = c.req.query("tok") ?? "";
  if (tok.length === 0) {
    return c.body(renderSetupError("missing", "The URL has no ?tok= parameter."), 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
  }

  const verdict = otpStore.consume(tok);
  if (!verdict.ok) {
    const detailByReason: Record<string, string> = {
      unknown: "The setup token is not recognised. It may have already been used, expired, or never existed.",
      expired: "The setup token has expired (5-min TTL). Generate a fresh one.",
      used: "The setup token has already been used. Generate a fresh one.",
    };
    return c.body(
      renderSetupError(verdict.reason, detailByReason[verdict.reason] ?? "Unknown error."),
      400,
      { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    );
  }

  // OTP was valid + is now marked used. Resolve the actual Bearer.
  const src = await resolveAuthSource();
  if (src.secret === null) {
    return c.body(
      renderSetupError(
        "unavailable",
        "The Bearer secret could not be read from the configured source (Keychain / token file / dev env). See docs/runbooks/gosleep-core.md § 3.",
      ),
      503,
      { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    );
  }

  const html = await renderBootstrapHtml(src.secret);
  if (html === null) {
    return c.body(
      renderSetupError(
        "no-bundle",
        "The web bundle is missing. Run `bun run --filter='@gosleep/web' build` first.",
      ),
      500,
      { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    );
  }
  return c.body(html, 200, {
    "content-type": "text/html; charset=utf-8",
    // The meta-tag Bearer must never enter any cache — this response is unique per session.
    "cache-control": "no-store",
  });
});
