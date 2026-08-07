// @gosleep/core — internal-secret middleware for POST /internal/* (GSL-275).
//
// The internal endpoints are the private control-plane surface a locally-running Claude Code
// hook script (tools/hooks/ask-user-question-hook.sh) uses to register a question in gosleep-core
// and long-poll for its answer. They live on the SAME Bun.serve process as the web endpoints but
// carry a DIFFERENT secret so a leaked web Bearer cannot masquerade as an agent-side hook (and
// vice versa).
//
// Auth model (per target-arch section 4.5 / 6.2 — "env-secret" class):
//   - Server reads `GOSLEEP_INTERNAL_SECRET` from process.env at request time.
//   - Client sends `X-Internal-Secret: <secret>`. A distinct HEADER, not Authorization, so a
//     misconfigured hook cannot accidentally satisfy the web Bearer check with the same string.
//   - Missing/empty env  → 503 Service Unavailable (never silent-unauth; same Delta-5 discipline
//     applied to the web Bearer). The hook falls back to fail-open on any non-200/204 response,
//     so 503 does not stall the session — it just means the answer-loop is off.
//   - Missing/empty header on the request → 401.
//   - Wrong secret → 401.
//   - Constant-time compare (timingSafeEqual over sha256 digests) so a byte-prefix search is
//     not measurable across a loopback socket.
//
// Not a substitute for other transport layers: requireLocalHost + (for POSTs) requireLocalOrigin
// still run in front of this middleware — /internal/* piggybacks on the app-wide layers, adding
// the internal-secret gate as the third check.

import type { MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export function getInternalSecret(): string {
  return process.env.GOSLEEP_INTERNAL_SECRET ?? "";
}

export const requireInternalSecret: MiddlewareHandler = async (c, next) => {
  const configured = getInternalSecret();
  if (configured.length === 0) {
    // No secret configured on the server — the internal loop is off. Return 503 rather than
    // silently accepting the request (Delta-5 discipline: never silent-unauth). The hook script
    // reads this as "core reachable but internal off" and fails open (no updatedInput → TUI).
    return c.text("internal secret not configured", 503);
  }
  const presented = (c.req.header("x-internal-secret") ?? "").trim();
  if (presented.length === 0) {
    return c.text("unauthorized", 401);
  }
  const a = digest(presented);
  const b = digest(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.text("unauthorized", 401);
  }
  await next();
};
