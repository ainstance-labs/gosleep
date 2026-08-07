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
import { actionsRoutes } from "./routes/actions.ts";
import { internalRoutes, stopToolObservedFlush } from "./routes/internal.ts";
import { getDb } from "./db/client.ts";
import { reconcileCursors } from "./indexer/reconcile.ts";
import { startTailIndexer, type TailController } from "./indexer/tail.ts";
import { startRotationWatcher, type RotationWatcher } from "./sse/rotation.ts";
import { writeAuthSourceAudit } from "./security/authSource.ts";
import { startFleetPoll, type FleetPollController } from "./workers/fleet-poll.ts";
import { startDeferReopen, type DeferReopenController } from "./workers/defer-reopen.ts";

const app = new Hono();

app.use("*", requireLocalHost);
app.use("*", requireLocalOrigin);
app.route("/", readRoutes);
app.route("/", eventsRoutes);
app.route("/", metricsRoutes);
app.route("/", actionsRoutes);
app.route("/", internalRoutes);

// -----------------------------------------------------------------------------
// indexer + broadcaster + rotation
// -----------------------------------------------------------------------------

let tail: TailController | null = null;
let rotation: RotationWatcher | null = null;
let fleet: FleetPollController | null = null;
let deferReopen: DeferReopenController | null = null;

// GSL-264 / GSL-280 — per-boot auth-source audit line runs INDEPENDENTLY of the indexer.
// The audit publishes the effective auth source (`recordAuthSource` → the metrics registry
// → /metrics reads it back) AND, best-effort, writes one event row for the web timeline.
// Split from the indexer boot so a headless / hermetic run (indexer disabled) still gets a
// truthful /metrics `gosleep_security_auth_source{source=…} 1` gauge. AWAITed at top level
// so the metrics registry has the label ready BEFORE Bun.serve binds and starts accepting
// scrapes — otherwise a fast scrape lands before the audit finishes and reads `source=none 1`.
await writeAuthSourceAudit(getDb());

if (process.env.GOSLEEP_DISABLE_INDEXER !== "1") {
  try {
    const db = getDb();
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

// Fleet-poll worker (GSL-276) — INDEPENDENT of the tail indexer. Reads `claude agents --json`
// via `@gosleep/runner-adapter` and reconciles into `agent_sessions`. Gated by its own env
// (GOSLEEP_DISABLE_FLEET_POLL=1) so:
//   * a headless test run can turn it off without disabling the whole indexer chain.
//   * the endpoint smoke (GOSLEEP_DISABLE_INDEXER=1 already set) still gets fleet-poll off by
//     default because the scratch smoke does not want a background CLI spawn.
// The default cadence is 4 s (range 3-5 s per Jira scope).
if (process.env.GOSLEEP_DISABLE_FLEET_POLL !== "1") {
  try {
    fleet = startFleetPoll(getDb());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "core.fleet_poll.boot_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// Defer-reopen worker (GSL-278). Ticks every 10 s by default; flips `status='deferred' AND
// defer_until <= now` back to open + clears defer_until, then emits a synthetic SSE event so
// the web client's Questions screen refreshes without waiting for the tail sweep. Gated by its
// own env (GOSLEEP_DISABLE_DEFER_REOPEN=1) so a hermetic test can turn it off without touching
// the indexer or the fleet-poll.
if (process.env.GOSLEEP_DISABLE_DEFER_REOPEN !== "1") {
  try {
    deferReopen = startDeferReopen(getDb());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "core.defer_reopen.boot_failed",
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
    await fleet?.stop();
  } catch {
    /* ignore */
  }
  try {
    await deferReopen?.stop();
  } catch {
    /* ignore */
  }
  try {
    await tail?.stop();
  } catch {
    /* ignore */
  }
  try {
    stopToolObservedFlush();
  } catch {
    /* ignore */
  }
  server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
