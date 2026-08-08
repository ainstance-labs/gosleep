// @gosleep/core — auth-source resolver + per-boot audit line (GSL-264, rev-3 addendum Delta 5).
//
// WHAT THIS OWNS. The fallback chain from Delta 5 — "how does the Bearer secret enter this
// process?" — resolved in ONE place with an audit trail. The chain, highest priority first:
//
//   1. GOSLEEP_BEARER_TOKEN (env dev-bypass)      — test-only seam used by core-smoke; skips the
//                                                    entire Keychain path. `source='dev-env'`.
//   2. macOS Keychain (`security find-generic-password`) — the production source, with the
//                                                    Delta-5 Tahoe timeout floor and Base64
//                                                    integrity check. `source='keychain'`.
//   3. GOSLEEP_TOKEN_PATH (file, 0600 recommended) — the DOCUMENTED explicit fallback, ONLY if
//                                                    the env var is set. Never inferred from a
//                                                    default path. `source='token-file'`.
//   4. Nothing              — the process has no Bearer secret; auth returns 503 on every
//                             protected route. `source='none'`.
//
// KEY RULE. There is NO silent degradation. If Keychain fails and `GOSLEEP_TOKEN_PATH` is not
// set, we return `null` and the request gets 503 — we do NOT fall back to plain-text unless
// the operator opted in with an env var. This is the gh CLI regression (silent unauth on
// keychain-timeout) we do not repeat.
//
// AUDIT LINE. On boot (uptime < 5 min OR the operator sets `GOSLEEP_AUDIT_ALWAYS=1` for tests),
// we log ONE line to stderr describing the effective source, and — if a DB handle is passed —
// we insert one `events` row of type `security.auth-source-audit` so the web timeline shows it.
// This proves to the owner that the auth source is Keychain and not a silently-slipped-in
// plaintext file that survived a dev session.

import { readFileSync, existsSync, statSync } from "node:fs";
import type { OpenedDb } from "../db/client.ts";
import { readKeychainSecret, type KeychainReadResult } from "./keychain.ts";
import { decodeSecret } from "./tokenEncoding.ts";
import { getPlatformInfo } from "./platform.ts";
import { getTokenFilePath, getDevBearerToken } from "../config.ts";
import { recordAuthSource } from "../metrics/registry.ts";

export type AuthSourceLabel = "dev-env" | "keychain" | "token-file" | "none";

export interface AuthSourceResult {
  /** The resolved Bearer secret; null if no source produced one. */
  secret: string | null;
  /** Which source in the fallback chain produced the secret (or 'none'). */
  source: AuthSourceLabel;
  /** Fallback notes for the audit line: 'none' when Keychain succeeded, else the reason it did
   *  not (e.g. 'keychain=timeout', 'keychain=exit-nonzero'). */
  fallback: string;
  /** Detail of the Keychain call (may be null if we short-circuited on the dev-env). */
  keychain: KeychainReadResult | null;
  /** Human-readable one-liner for the audit log. */
  auditLine: string;
}

/**
 * Resolve the Bearer secret against the Delta-5 chain. This is the ONE place the chain lives —
 * `bearer.ts` calls it, `serve.ts` calls it once at boot for the audit line. Idempotent.
 */
export async function resolveAuthSource(): Promise<AuthSourceResult> {
  // 1. Dev-env bypass — highest priority, used by core-smoke to skip Keychain entirely.
  const devBearer = getDevBearerToken();
  if (devBearer.length > 0) {
    return build({
      secret: devBearer,
      source: "dev-env",
      fallback: "none",
      keychain: null,
    });
  }

  // 2. Keychain — the production path.
  const kc = await readKeychainSecret();
  if (kc.secret !== null) {
    return build({
      secret: kc.secret,
      source: "keychain",
      fallback: "none",
      keychain: kc,
    });
  }

  // 3. Explicit token-file fallback — ONLY if GOSLEEP_TOKEN_PATH is set. Missing env → no fall-
  //    back (auth returns 503). This is the "never silently degrade" rule.
  const tokenPath = getTokenFilePath();
  if (tokenPath.length > 0) {
    const fileSecret = readTokenFile(tokenPath);
    if (fileSecret !== null) {
      return build({
        secret: fileSecret,
        source: "token-file",
        fallback: `keychain=${kc.reason}`,
        keychain: kc,
      });
    }
    // Token-file was configured but empty/missing/corrupted — log and 503. Still no plaintext
    // silent-fall-through.
    return build({
      secret: null,
      source: "none",
      fallback: `keychain=${kc.reason};token-file=missing-or-invalid`,
      keychain: kc,
    });
  }

  // 4. Nothing left. 503-on-every-request.
  return build({
    secret: null,
    source: "none",
    fallback: `keychain=${kc.reason}`,
    keychain: kc,
  });
}

function build(partial: {
  secret: string | null;
  source: AuthSourceLabel;
  fallback: string;
  keychain: KeychainReadResult | null;
}): AuthSourceResult {
  const platform = getPlatformInfo();
  const tahoe = platform.isTahoe ? "yes" : "no";
  const timeout = partial.keychain?.timeoutMs ?? "";
  const line =
    `auth-source: ${partial.source} | fallback: ${partial.fallback} | tahoe=${tahoe}` +
    (timeout !== "" ? ` | keychain-timeout-ms=${timeout}` : "");
  return { ...partial, auditLine: line };
}

/**
 * Read a plain-text token from an operator-provided file. The file must exist, be non-empty,
 * and be at most 4 KiB (Bearer tokens should not be novels). The value MAY be a `b64v1:`
 * prefixed encoding, in which case we decode it — same shim as Keychain, so operators can
 * hand-copy encoded values between the two paths without re-encoding. On any failure returns
 * null (the caller logs the reason via the fallback string).
 */
function readTokenFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const st = statSync(path);
    if (!st.isFile()) return null;
    if (st.size <= 0 || st.size > 4096) return null;
    const raw = readFileSync(path, "utf8").replace(/\n$/, "").trim();
    if (raw.length === 0) return null;
    const decoded = decodeSecret(raw);
    return decoded;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------------------------
// Per-boot audit line
// --------------------------------------------------------------------------------------------

const AUDIT_UPTIME_CEILING_S = 300; // 5 min — matches Delta 5

/**
 * Write the audit line at process boot. Emits:
 *   1. One structured JSON line to stderr (always).
 *   2. If a DB handle is passed AND the process is fresh (uptime < 5 min OR
 *      GOSLEEP_AUDIT_ALWAYS=1), one row into `events` with type='security.auth-source-audit'.
 *
 * Idempotent by design — safe to call more than once, but production only calls it from
 * serve.ts's boot sequence.
 */
export async function writeAuthSourceAudit(
  db: OpenedDb | null,
): Promise<AuthSourceResult> {
  const result = await resolveAuthSource();
  const platform = getPlatformInfo();
  // GSL-280: publish the currently-active source label to the metrics registry so
  // `gosleep_security_auth_source{source="<label>"} 1` reads it back on /metrics scrapes.
  recordAuthSource(result.source);

  // stderr line — always. `console.error` because launchd captures it into
  // data/logs/core-stderr.log per the plist template.
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "core.security.auth-source-audit",
      source: result.source,
      fallback: result.fallback,
      tahoe: platform.isTahoe,
      darwin_major: platform.darwinMajor,
      product_version: platform.productVersion,
      keychain_timeout_ms: result.keychain?.timeoutMs ?? null,
      keychain_reason: result.keychain?.reason ?? null,
      uptime_seconds: Math.round(platform.uptimeSeconds),
      line: result.auditLine,
    }),
  );

  const isFresh = platform.uptimeSeconds < AUDIT_UPTIME_CEILING_S;
  const forced = process.env.GOSLEEP_AUDIT_ALWAYS === "1";
  if (db !== null && (isFresh || forced)) {
    try {
      const now = new Date().toISOString();
      const day = now.slice(0, 10);
      db.raw
        .prepare(
          "INSERT INTO events (day, ts, src, actor, task, type, payload, supersedes_seq, ingested_from) " +
            "VALUES (?, ?, 'core', 'core', NULL, 'security.auth-source-audit', ?, NULL, NULL)",
        )
        .run(
          day,
          now,
          JSON.stringify({
            source: result.source,
            fallback: result.fallback,
            tahoe: platform.isTahoe,
            darwin_major: platform.darwinMajor,
            product_version: platform.productVersion,
            keychain_timeout_ms: result.keychain?.timeoutMs ?? null,
            keychain_reason: result.keychain?.reason ?? null,
            uptime_seconds: Math.round(platform.uptimeSeconds),
            line: result.auditLine,
          }),
        );
    } catch (err) {
      // A failed audit insert must NOT kill the boot — the stderr line above is the primary
      // record of truth; the DB row is a nice-to-have for the timeline UI.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.security.auth-source-audit.db-write-failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return result;
}
