// @gosleep/core — Host header middleware (GSL-260).
//
// Bind is 127.0.0.1:7331 (config.HOST/PORT). The Host header MUST match — DNS rebinding attacks
// and any external client that sneaks past bind must be rejected here as well as at the socket.
// This is layer 1 of the transport-security stack (Host → Origin → Bearer).

import type { MiddlewareHandler } from "hono";
import { HOST_HEADER } from "../config.ts";

export const requireLocalHost: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host");
  if (host !== HOST_HEADER) {
    return c.text("bad host", 421); // Misdirected Request — semantically correct for wrong Host
  }
  await next();
};
