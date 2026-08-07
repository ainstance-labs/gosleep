// @gosleep/core — Origin/Referer middleware (GSL-260).
//
// Cross-site request forgery guard for browser-driven POSTs. Rule (target-architecture 7.3
// "Приоритет 4"):
//   - At least one of Origin / Referer must be present.
//   - If both are present, they must agree on origin.
//   - When present, they must match http://127.0.0.1:7331 (our own origin).
//
// SAFE-METHOD escape hatch: GET/HEAD/OPTIONS bypass this check — they are read-only, and a
// browser preflight (OPTIONS) can legally arrive without a same-origin Origin header. All the
// interesting-blast requests (POST + friends) go through the full check.

import type { MiddlewareHandler } from "hono";
import { HOST_HEADER } from "../config.ts";

const SELF_ORIGIN = `http://${HOST_HEADER}`;

const originOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
};

export const requireLocalOrigin: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }

  const origin = c.req.header("origin") ?? null;
  const referer = c.req.header("referer") ?? null;
  const refOrigin = referer !== null ? originOf(referer) : null;

  if (origin === null && refOrigin === null) {
    return c.text("origin required", 403);
  }
  if (origin !== null && refOrigin !== null && origin !== refOrigin) {
    return c.text("origin/referer disagree", 403);
  }
  const declared = origin ?? refOrigin;
  if (declared !== SELF_ORIGIN) {
    return c.text("cross-origin blocked", 403);
  }
  await next();
};
