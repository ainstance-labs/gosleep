// @gosleep/core — Bearer token middleware (GSL-260; target-architecture R38).
//
// Reads the Bearer secret from macOS Keychain (or the dev-env override) via
// security/keychain.ts. Constant-time comparison against the request's Authorization header.
//
// FAILURE MODES (per rev-3 addendum Delta 5 and target-architecture R29):
//   - Missing/malformed Authorization header       → 401 Unauthorized.
//   - Header present but wrong secret              → 401 Unauthorized.
//   - Keychain lookup returned null (timeout, missing item, security CLI failed)
//                                                  → 503 Service Unavailable — NEVER silently
//                                                    fall back to unauth (this is exactly the
//                                                    gh CLI bug we do not repeat).
//
// Constant-time compare is mandatory: a naive string === would leak the byte prefix through
// timing. Node's timingSafeEqual works on Buffers of equal length; we equalise via SHA-256
// so any-length input is compared in constant time.

import type { MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { readBearerFromKeychain } from "./keychain.ts";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export const requireBearer: MiddlewareHandler = async (c, next) => {
  const secret = await readBearerFromKeychain();
  if (secret === null) {
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
  const b = digest(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.text("unauthorized", 401);
  }

  await next();
};
