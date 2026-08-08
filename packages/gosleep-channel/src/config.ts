// @gosleep/channel — env-flag guard (GSL-282, rev-3 addendum Delta 2).
//
// The plugin loads exactly nothing unless BOTH switches are on:
//   1. Claude Code was launched with --dangerously-load-development-channels
//      (that gate is enforced by Claude Code itself — we cannot see it from here).
//   2. GOSLEEP_ENABLE_CHANNELS=1 is present in the process env at startup.
//
// This second guard is why `packages/gosleep-channel/src/bin/gosleep-channel.ts`
// exits 0 immediately when the env is unset — it stops a stray
// --dangerously-load-development-channels sitting in a shell history from
// accidentally exposing the channel to an unrelated Claude Code session.
//
// See README.md § "Enabling the plugin (opt-in, per session)" for the full
// rationale.

/**
 * Read GOSLEEP_ENABLE_CHANNELS from the process env, tolerating both
 * "1" (canonical) and "true" (a common typo). Anything else — including
 * "0", "false", the empty string, or absence — returns false.
 *
 * A false return means: do nothing, register no MCP handlers, exit 0.
 */
export function channelsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.GOSLEEP_ENABLE_CHANNELS;
  if (raw === undefined) return false;
  const norm = raw.trim().toLowerCase();
  return norm === "1" || norm === "true";
}

/**
 * The `gosleep-core` internal endpoint the relay POSTs to. The port is fixed
 * (see `docs/reports/web-harness-research-2026-08-03/target-architecture.md`
 * §5.1) — the plugin does not accept a URL override, on purpose: a channel
 * that can be pointed at an arbitrary host defeats the whole point of the
 * `--dangerously-load-development-channels` local-trust model.
 *
 * The internal secret comes from the env (same var the rest of the internal
 * loop uses, so pilot sessions have it wired already — see
 * `apps/core/src/security/internalSecret.ts` and
 * `docs/runbooks/gosleep-core.md` § 8).
 */
export const CORE_BASE_URL = "http://127.0.0.1:7331";

/** Absolute path to the relay endpoint on gosleep-core. */
export function permissionRelayUrl(base: string = CORE_BASE_URL): string {
  return `${base}/internal/permission-relay`;
}

/** Absolute path to the decision-wait long-poll endpoint on gosleep-core. */
export function permissionDecisionWaitUrl(qid: string, base: string = CORE_BASE_URL): string {
  const safe = encodeURIComponent(qid);
  return `${base}/internal/permissions/${safe}/decision-wait`;
}

/** Absolute path to the steer-drain endpoint on gosleep-core. */
export function steerDrainUrl(sessionId: string, base: string = CORE_BASE_URL): string {
  const safe = encodeURIComponent(sessionId);
  return `${base}/internal/steer/${safe}/drain`;
}

/**
 * Fetch the internal-secret header value. Never crashes on undefined — the
 * caller is expected to treat a missing secret as "core is off, fail open"
 * exactly as the hook shims do (`docs/runbooks/gosleep-core.md` § 4).
 */
export function internalSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.GOSLEEP_INTERNAL_SECRET;
  if (raw === undefined || raw.length === 0) return undefined;
  return raw;
}
