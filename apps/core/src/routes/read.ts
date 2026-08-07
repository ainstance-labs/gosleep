// @gosleep/core — read-only route table v1 (GSL-260).
//
// The three endpoints the Jira description enumerates:
//   GET /healthz  — always 200, no auth. Liveness probe (launchd / debounce / smoke).
//   GET /version  — Bearer required. Reports server + API versions.
//   GET /whoami   — Bearer required. Reports the owner identity (from config).
//
// This file OWNS the /healthz | /version | /whoami handlers. The Bearer middleware is applied
// per-route here (not app-wide), because /healthz must stay reachable without any secret in
// scope so a launchd probe can tell "the process is alive" from "the Keychain lookup failed".
// Host + Origin middleware are applied at the app level (serve.ts) — they must run for every
// request regardless of route.

import { Hono } from "hono";
import { SERVER_VERSION, API_VERSIONS, OWNER_NAME } from "../config.ts";
import { requireBearer } from "../security/bearer.ts";

export const readRoutes = new Hono();

readRoutes.get("/healthz", (c) =>
  c.json({ ok: true, service: "gosleep-core" }),
);

readRoutes.get("/version", requireBearer, (c) =>
  c.json({
    server_version: SERVER_VERSION,
    api_versions: API_VERSIONS,
    // db_schema_version filled in by GSL-261 (Drizzle journal hash). "unset" is honest for now.
    db_schema_version: "unset",
  }),
);

readRoutes.get("/whoami", requireBearer, (c) => c.json({ owner: OWNER_NAME }));
