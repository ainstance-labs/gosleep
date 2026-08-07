// @gosleep/core — server entry (GSL-260, GSL-263).
//
// Boots the Hono app on 127.0.0.1:7331 via Bun.serve. Middleware layers (must not be reshuffled):
//   1. requireLocalHost   — reject wrong-Host requests (DNS rebinding). App-wide.
//   2. requireLocalOrigin — CSRF guard for state-changing methods; safe methods bypass. App-wide.
//   3. requireBearer      — applied per-route inside routes/*.ts; /healthz stays public.
//
// GSL-263 additions:
//   - Reconciler runs ONCE at boot (sha256 tripwire → cursor reset for edited files).
//   - Tail indexer starts and drains new JSONL lines into SQLite, fanning to the SSE broadcaster.
//   - Rotation watcher fires `event: rotate` on UTC-day transitions.
//   - `/events` (SSE), `/status`, `/questions`, `/skills`, `/timeline`, `/tasks`, `/cost`,
//     `/fleet`, `/bundle`, and a `/metrics` stub join the v1 route surface.
//
// Env knobs (test-only unless noted):
//   GOSLEEP_DISABLE_INDEXER=1   skip reconciler + tail + rotation (used by the endpoint smoke —
//                               it wants a hermetic server that only serves stubbed queries).

import { Hono } from "hono";

import { HOST, PORT } from "./config.ts";
import { requireLocalHost } from "./security/host.ts";
import { requireLocalOrigin } from "./security/origin.ts";
import { readRoutes } from "./routes/read.ts";
import { eventsRoutes } from "./routes/events.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { getDb } from "./db/client.ts";
import { reconcileCursors } from "./indexer/reconcile.ts";
import { startTailIndexer, type TailController } from "./indexer/tail.ts";
import { startRotationWatcher, type RotationWatcher } from "./sse/rotation.ts";
import { writeAuthSourceAudit } from "./security/authSource.ts";

const app = new Hono();

app.use("*", requireLocalHost);
app.use("*", requireLocalOrigin);
app.route("/", readRoutes);
app.route("/", eventsRoutes);
app.route("/", metricsRoutes);

// -----------------------------------------------------------------------------
// indexer + broadcaster + rotation
// -----------------------------------------------------------------------------

let tail: TailController | null = null;
let rotation: RotationWatcher | null = null;

if (process.env.GOSLEEP_DISABLE_INDEXER !== "1") {
  try {
    const db = getDb();
    // 0. Per-boot auth-source audit line (GSL-264, rev-3 addendum Delta 5). Runs BEFORE the
    //    indexer so a failed reconcile does not swallow the audit line. Best-effort — a failure
    //    inside writeAuthSourceAudit only logs to stderr; boot proceeds.
    void writeAuthSourceAudit(db);
    // 1. Reconcile before starting the tail — otherwise a file edited while we were down
    //    would be tail-appended from the OLD cursor and we would miss the corrected prefix.
    reconcileCursors(db);
    // 2. Tail: fs.watch + 10 s poll fallback, broadcasts to SSE via broadcaster.emit().
    tail = startTailIndexer(db);
    // 3. UTC day rotation: 60 s tick, fires `event: rotate` on transition.
    rotation = startRotationWatcher();
  } catch (err) {
    // A failed boot of the indexer must NOT kill the server — /healthz should still work so
    // launchd can restart cleanly. Log loudly and continue.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "core.indexer.boot_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  // idleTimeout=0 disables the 10s default that would kill open SSE streams. SSE is long-lived
  // by contract; the heartbeat comment every 20s + client onclose handle the liveness detection.
  idleTimeout: 0,
  fetch: app.fetch,
});

// One log line so `bash plist.sh status` (via `launchctl print`) has something to point at.
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    event: "core.listen",
    host: server.hostname,
    port: server.port,
    indexer_disabled: process.env.GOSLEEP_DISABLE_INDEXER === "1",
  }),
);

// Clean shutdown — best-effort. SIGTERM comes from launchd on unload; SIGINT from a manual Ctrl-C.
const shutdown = async (signal: string): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "core.shutdown", signal }));
  try {
    rotation?.stop();
  } catch {
    /* ignore */
  }
  try {
    await tail?.stop();
  } catch {
    /* ignore */
  }
  server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
