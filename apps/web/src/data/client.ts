// @gosleep/web — CoreClient singleton (GSL-265).
//
// Wraps @gosleep/sdk with the Bearer discovery from `./auth`. Every screen imports
// `coreClient` and passes it to the TanStack Query hooks in `./queries`.
//
// Base URL: in dev, we route through Vite's proxy under `/api/*` so that react-router 7
// URLs like `/tasks` and `/questions` do NOT collide with the core's read endpoints of the
// same name. The vite.config.ts proxy rewrites `/api/tasks` → `http://127.0.0.1:7331/tasks`.
// In prod, the SPA is served from the same origin as gosleep-core (127.0.0.1:7331), so the
// base is empty and every fetch hits `${origin}/status`, `${origin}/questions`, etc.

import { CoreClient } from "@gosleep/sdk";
import { getBearer } from "./auth";

const DEV_API_BASE = "/api";
const PROD_API_BASE = "";

const isDev = import.meta.env.DEV;
const originBase =
  typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:7331";

export const coreClient = new CoreClient({
  baseUrl: isDev ? `${originBase}${DEV_API_BASE}` : `${originBase}${PROD_API_BASE}`,
  getBearer,
});

/** Base URL the SseProvider passes to `subscribe()` — must match CoreClient's rewrite so
 *  `/events` also goes through the `/api` prefix in dev. */
export const sseBaseUrl = isDev ? `${originBase}${DEV_API_BASE}` : `${originBase}${PROD_API_BASE}`;
