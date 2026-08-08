// @gosleep/core — macOS Keychain wrapper (GSL-260 baseline, GSL-264 hardening).
//
// Reads a generic-password entry via the `security` CLI, with a HARD timeout ceiling. On
// timeout OR non-zero exit → returns `null`; callers must translate `null` into `503 Service
// Unavailable` (never fall through to unauth — that is the gh-CLI regression
// github.com/cli/cli/issues/13317 we explicitly avoid).
//
// GSL-264 (rev-3 addendum Delta 5) adds:
//   1. Tahoe-aware timeout floor  — on macOS 26.x the timeout is floored to KEYCHAIN_TIMEOUT_MS
//                                    (default 5 s) regardless of a lower override, because the
//                                    26.x `security -w` regression can otherwise wedge boot.
//   2. On-disk Base64 shim         — decodeSecret() unwraps `b64v1:...` values (see
//                                    tokenEncoding.ts). Integrity failure returns null (503).
//   3. Detailed result object      — readKeychainSecret() returns a `KeychainReadResult` so the
//                                    auth-source resolver can log WHY a read failed. The legacy
//                                    `readBearerFromKeychain()` (thin string-or-null wrapper)
//                                    is kept for the bearer middleware's tight path.
//
// The ACL binding (`-T <trusted-app>` on install) lives in `apps/core/plist.sh`; this reader is
// unaffected by the ACL choice at read time — Keychain grants (allow-always) is what makes the
// binding invisible to us here.

import { spawn } from "node:child_process";
import {
  getKeychainService,
  getKeychainAccount,
  getKeychainTimeoutMs,
  getDevBearerToken,
} from "../config.ts";
import { getPlatformInfo, _resetPlatformInfoForTests } from "./platform.ts";
import { decodeSecret } from "./tokenEncoding.ts";

/**
 * Structured result of a Keychain read. `reason` is a short machine-readable tag so the audit
 * line can name the failure mode without leaking the secret or the raw stderr.
 */
export interface KeychainReadResult {
  /** Decoded secret on success; null on any failure. */
  secret: string | null;
  /** Machine-readable reason: 'ok' | 'dev-bypass' | 'no-account' | 'timeout' | 'exit-nonzero'
   *  | 'empty' | 'decode-failed' | 'spawn-error'. */
  reason:
    | "ok"
    | "dev-bypass"
    | "no-account"
    | "timeout"
    | "exit-nonzero"
    | "empty"
    | "decode-failed"
    | "spawn-error";
  /** Effective timeout that was applied (ms). */
  timeoutMs: number;
  /** `security` CLI exit code, if the process ran to completion. */
  exitCode: number | null;
}

/**
 * Delta-5 policy: on Tahoe 26.x the KEYCHAIN_TIMEOUT_MS default (5000) is a FLOOR — a config
 * override that specifies a shorter value is IGNORED on Tahoe, because the -w regression on
 * that release can otherwise trip a false 503 on a still-live Keychain.
 */
function effectiveTimeoutMs(): number {
  // Re-detect the platform on every call — cheap (memoized after the first) but ensures test
  // seams (GOSLEEP_PLATFORM_OVERRIDE) that flip between scenarios are honoured. The reset
  // seam guarantees a clean slate per test run.
  _resetPlatformInfoForTests();
  const platform = getPlatformInfo();
  const configured = getKeychainTimeoutMs();
  if (platform.isTahoe) {
    // Floor at 5000 ms; take the max of configured value and the floor.
    return Math.max(configured, 5000);
  }
  return configured;
}

/**
 * Full-detail Keychain read. New in GSL-264 — the auth-source resolver uses this so it can
 * report WHY the read failed (timeout vs missing item vs decode-failed).
 */
export async function readKeychainSecret(): Promise<KeychainReadResult> {
  const timeoutMs = effectiveTimeoutMs();

  // Dev/test seam: an explicit env override skips the shell out entirely.
  const devBearer = getDevBearerToken();
  if (devBearer.length > 0) {
    return {
      secret: devBearer,
      reason: "dev-bypass",
      timeoutMs,
      exitCode: null,
    };
  }

  const account = getKeychainAccount();
  const service = getKeychainService();
  if (account.length === 0) {
    return { secret: null, reason: "no-account", timeoutMs, exitCode: null };
  }

  return new Promise<KeychainReadResult>((resolve) => {
    let child;
    try {
      child = spawn(
        "security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      resolve({ secret: null, reason: "spawn-error", timeoutMs, exitCode: null });
      return;
    }

    let stdout = "";
    let settled = false;

    const settle = (r: KeychainReadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      settle({ secret: null, reason: "timeout", timeoutMs, exitCode: null });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => settle({ secret: null, reason: "spawn-error", timeoutMs, exitCode: null }));
    child.on("close", (code) => {
      if (code !== 0) {
        settle({ secret: null, reason: "exit-nonzero", timeoutMs, exitCode: code });
        return;
      }
      // `security -w` prints the secret + trailing newline. Trim only the trailing newline;
      // the secret itself may legally contain whitespace we must not eat.
      const trimmed = stdout.replace(/\n$/, "");
      if (trimmed.length === 0) {
        settle({ secret: null, reason: "empty", timeoutMs, exitCode: code });
        return;
      }
      const decoded = decodeSecret(trimmed);
      if (decoded === null) {
        settle({ secret: null, reason: "decode-failed", timeoutMs, exitCode: code });
        return;
      }
      settle({ secret: decoded, reason: "ok", timeoutMs, exitCode: code });
    });
  });
}

/**
 * Legacy thin wrapper — returns the secret string on success, `null` on any failure. Kept for
 * the bearer middleware's hot path (see security/bearer.ts) and any caller that does not care
 * about the failure reason. New code should prefer `readKeychainSecret()`.
 */
export async function readBearerFromKeychain(): Promise<string | null> {
  const r = await readKeychainSecret();
  return r.secret;
}
