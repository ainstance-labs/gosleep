// @gosleep/core — runtime config (GSL-260).
//
// Single source of truth for env, paths, and the Keychain-service names. Every module that needs
// a host, a bind port, or a secret goes through this file — the goal is that a smoke test can
// tweak ONE env override (e.g. GOSLEEP_BEARER_TOKEN) and the whole app runs against a scratch
// state without ever touching the owner's real Keychain.
//
// Config precedence (Bun-runtime env only; no dotenv side channels):
//   1. explicit env var (GOSLEEP_*)                            highest
//   2. defaults in this file                                    lowest
//
// Nothing here reads from disk yet — Keychain lookup lives in security/keychain.ts and is called
// only when the Bearer middleware actually needs the secret.

export const HOST = "127.0.0.1";
export const PORT = Number.parseInt(process.env.GOSLEEP_CORE_PORT ?? "7331", 10);

// The exact string we require in the Host header (see security/host.ts). Matches what launchd +
// plist.sh point the client at. Bind + advertised host must agree, or the middleware locks the
// client out of the very server it just booted.
export const HOST_HEADER = `${HOST}:${PORT}`;

// Keychain lookup — service/account keys used with macOS `security` CLI.
export const KEYCHAIN_SERVICE = process.env.GOSLEEP_KEYCHAIN_SERVICE ?? "gosleep-web";
export const KEYCHAIN_ACCOUNT = process.env.GOSLEEP_KEYCHAIN_ACCOUNT ?? (process.env.USER ?? "");

// Test/dev seam: if this env is set at process start, the Keychain lookup is BYPASSED and the
// Bearer middleware accepts this literal value. Never set in production (plist.sh does not
// export it). This is the seam that lets tools/lab/tests/core-smoke.sh run without a live
// Keychain item.
export const DEV_BEARER_TOKEN = process.env.GOSLEEP_BEARER_TOKEN ?? "";

// Server / API version reported by GET /version. Bumped by hand on breaking changes; the
// db_schema_version placeholder is filled in a later task (GSL-261 Drizzle schema).
export const SERVER_VERSION = "0.0.1";
export const API_VERSIONS = ["v1"] as const;

// Keychain wrapper's timeout ceiling, per rev-3 addendum Delta 5 (never silently unauth; return
// 503 instead). 5 seconds is the hard cap the addendum specifies for macOS Tahoe 26.x, and 5s
// is a safe upper bound for all supported versions. Env override kept for test purposes only.
export const KEYCHAIN_TIMEOUT_MS = Number.parseInt(
  process.env.GOSLEEP_KEYCHAIN_TIMEOUT_MS ?? "5000",
  10,
);

// Owner display name (surfaced by GET /whoami). Sourced from env with a system-user fallback.
// Task-scope: no Directory lookup yet; a future task can wire this to a Keychain entry keyed on
// account name.
export const OWNER_NAME = process.env.GOSLEEP_OWNER_NAME ?? (process.env.USER ?? "unknown");
