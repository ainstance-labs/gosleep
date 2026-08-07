// @gosleep/core — /metrics stub (GSL-263 wiring; full impl GSL-280 per rev-3 addendum Delta 7).
//
// Rev-3 addendum Delta 7 filed the full Prometheus exposition — histograms per endpoint,
// counters per SSE event type, indexer lag gauges — under a separate task (GSL-280). This
// stub is the ROUTE WIRING only: it exposes `GET /metrics` with a minimal, syntactically
// valid Prometheus exposition so a scraper configured against this endpoint gets 200 + parseable
// output instead of a 404 or a permission denial.
//
// Auth model: `/metrics` in this stub REQUIRES the Bearer, matching every other data-adjacent
// read. The rev-3 addendum leaves the auth decision to GSL-280 (per-scraper token, mutual TLS,
// etc.); the safe default until then is "same as /status".
//
// What we emit today:
//   - `gosleep_up 1` — the process is alive.
//   - `gosleep_events_total N` — count of rows in the events table (cheap gauge; a scrape every
//     15 s is fine).
// The names + HELP + TYPE lines follow the Prometheus exposition spec so a scraper does not
// choke on them.

import { Hono } from "hono";

import { requireBearer } from "../security/bearer.ts";
import { getDb } from "../db/client.ts";

export const metricsRoutes = new Hono();

metricsRoutes.get("/metrics", requireBearer, (c) => {
  const eventsRow = getDb().raw.query("SELECT count(*) AS n FROM events").get() as { n: number };
  const body = [
    "# HELP gosleep_up 1 if the control-plane process is serving requests.",
    "# TYPE gosleep_up gauge",
    "gosleep_up 1",
    "# HELP gosleep_events_total Row count in the events table.",
    "# TYPE gosleep_events_total gauge",
    `gosleep_events_total ${eventsRow.n}`,
    "# NOTE: GSL-263 wired this route as a stub. Full exposition (per-endpoint histograms,",
    "# per-type SSE counters, indexer lag) lands with GSL-280.",
    "",
  ].join("\n");
  return c.text(body, 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
});
