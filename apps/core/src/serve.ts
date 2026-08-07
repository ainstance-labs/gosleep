// @gosleep/core — server entry (GSL-260).
//
// Boots the Hono app on 127.0.0.1:7331 via Bun.serve. Middleware layers (must not be reshuffled):
//   1. requireLocalHost   — reject wrong-Host requests (DNS rebinding). App-wide.
//   2. requireLocalOrigin — CSRF guard for state-changing methods; safe methods bypass. App-wide.
//   3. requireBearer      — applied per-route inside routes/read.ts; /healthz stays public.
//
// The v1 route surface is READ-ONLY. Write actions (POST /actions/*) land in later tasks and
// will re-use the same middleware stack.

import { Hono } from "hono";
import { HOST, PORT } from "./config.ts";
import { requireLocalHost } from "./security/host.ts";
import { requireLocalOrigin } from "./security/origin.ts";
import { readRoutes } from "./routes/read.ts";

const app = new Hono();

app.use("*", requireLocalHost);
app.use("*", requireLocalOrigin);
app.route("/", readRoutes);

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch: app.fetch,
});

// One log line to stdout so `bash plist.sh status` (via `launchctl print`) has something to
// point at. Structured logging (pino) is wired in a later task; this is just enough for smoke.
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    event: "core.listen",
    host: server.hostname,
    port: server.port,
  }),
);
