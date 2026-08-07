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
//
// SECURITY-RELATED CONFIG IS LAZY BY DESIGN. Every getter below reads `process.env` at CALL
// time (not at module import). This is required for the Delta-5 auth-source unit tests which
// swap env between cases (dev-bypass → token-file → nothing → …); a frozen module-level const
// would capture the value at first import and every later test would see the stale value. The
// convention: security-related knobs are functions (`getFoo()`), the rest stay as top-level
// consts because they are set once at process launch and never change under test.
export function getKeychainService(): string {
  return process.env.GOSLEEP_KEYCHAIN_SERVICE ?? "gosleep-web";
}
export function getKeychainAccount(): string {
  return process.env.GOSLEEP_KEYCHAIN_ACCOUNT ?? (process.env.USER ?? "");
}

// Test/dev seam: if this env is set at process start, the Keychain lookup is BYPASSED and the
// Bearer middleware accepts this literal value. Never set in production (plist.sh does not
// export it). This is the seam that lets tools/lab/tests/core-smoke.sh run without a live
// Keychain item.
export function getDevBearerToken(): string {
  return process.env.GOSLEEP_BEARER_TOKEN ?? "";
}

// GSL-264 (Delta 5) — explicit token-file fallback path. Set to a filesystem path to opt into
// the documented plain-file fallback (used when Keychain is unreachable AND the operator has
// deliberately configured a file-based rescue). Unset (empty) = no fallback (503 on Keychain
// failure). NEVER inferred from a default location — the operator must set this by hand.
export function getTokenFilePath(): string {
  return process.env.GOSLEEP_TOKEN_PATH ?? "";
}

// Server / API version reported by GET /version. Bumped by hand on breaking changes; the
// db_schema_version placeholder is filled in a later task (GSL-261 Drizzle schema).
export const SERVER_VERSION = "0.0.1";
export const API_VERSIONS = ["v1"] as const;

// Keychain wrapper's timeout ceiling, per rev-3 addendum Delta 5 (never silently unauth; return
// 503 instead). 5 seconds is the hard cap the addendum specifies for macOS Tahoe 26.x, and 5s
// is a safe upper bound for all supported versions. Env override kept for test purposes only.
export function getKeychainTimeoutMs(): number {
  return Number.parseInt(process.env.GOSLEEP_KEYCHAIN_TIMEOUT_MS ?? "5000", 10);
}

// Owner display name (surfaced by GET /whoami). Sourced from env with a system-user fallback.
// Task-scope: no Directory lookup yet; a future task can wire this to a Keychain entry keyed on
// account name.
export const OWNER_NAME = process.env.GOSLEEP_OWNER_NAME ?? (process.env.USER ?? "unknown");
