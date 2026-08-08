// @gosleep/core — /metrics (Prometheus text exposition, GSL-280 / rev-3 addendum Delta 7).
//
// Local observability without shipping to an external Prometheus. `curl 127.0.0.1:7331/metrics`
// prints a text exposition the operator can eyeball or point a personal promtail/vmagent at.
// Bearer'd (same layer as every other data-adjacent read) and bound only to 127.0.0.1 by the
// app-wide requireLocalHost middleware; the ticket rules out an external scrape design.
//
// The exposition itself is built by `metrics/registry.ts::buildPrometheusText` — this route is
// the thin HTTP layer around it. Split so a unit test can exercise the text builder without
// booting a server (see `test/metrics.test.ts`), and so a future JSON exposition (or a lower-
// cardinality shortcut for a dashboard) can share the same aggregation code.

import { Hono } from "hono";

import { requireBearer } from "../security/bearer.ts";
import { getDb } from "../db/client.ts";
import { buildPrometheusText, incCounter } from "../metrics/registry.ts";

export const metricsRoutes = new Hono();

metricsRoutes.get("/metrics", requireBearer, (c) => {
  // Bump a counter on every scrape — cheap self-observability ("did the scraper hit us?").
  incCounter("gosleep_http_requests_total", {
    endpoint: "/metrics",
    method: "GET",
    status: "200",
  });
  const body = buildPrometheusText(getDb());
  return c.text(body, 200, {
    // The `version=0.0.4` MIME extension is the Prometheus convention; scrapers that require
    // it (an old prometheus-cpp for instance) refuse content-types missing the parameter.
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

// Re-export the record functions from the registry so peers (security/authSource.ts,
// routes/internal.ts's long-poll wait) can call them without a deeper import path.
export {
  incCounter,
  observeHookWait,
  recordAuthSource,
} from "../metrics/registry.ts";
