// @gosleep/core — Bearer token middleware (GSL-260 baseline, GSL-264 hardening).
//
// Reads the Bearer secret via the Delta-5 fallback chain (`resolveAuthSource()` — dev-env →
// Keychain → GOSLEEP_TOKEN_PATH → nothing). Constant-time comparison against the request's
// Authorization header.
//
// FAILURE MODES (per rev-3 addendum Delta 5 and target-architecture R29):
//   - Missing/malformed Authorization header       → 401 Unauthorized.
//   - Header present but wrong secret              → 401 Unauthorized.
//   - No source produced a secret                  → 503 Service Unavailable — NEVER silently
//                                                    fall back to unauth (this is exactly the
//                                                    gh CLI bug we do not repeat).
//
// Constant-time compare is mandatory: a naive string === would leak the byte prefix through
// timing. Node's timingSafeEqual works on Buffers of equal length; we equalise via SHA-256
// so any-length input is compared in constant time.

import type { MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveAuthSource } from "./authSource.ts";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export const requireBearer: MiddlewareHandler = async (c, next) => {
  const src = await resolveAuthSource();
  if (src.secret === null) {
    return c.text("keychain unavailable", 503);
  }

  const auth = c.req.header("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m === null || m[1] === undefined) {
    return c.text("unauthorized", 401);
  }
  const presented = m[1].trim();
  if (presented.length === 0) {
    return c.text("unauthorized", 401);
  }

  const a = digest(presented);
  const b = digest(src.secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.text("unauthorized", 401);
  }

  await next();
};
