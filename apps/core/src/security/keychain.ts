// @gosleep/core — macOS Keychain wrapper (GSL-260; rev-3 addendum Delta 5).
//
// Reads a generic-password entry via the `security` CLI, with a HARD timeout ceiling. On
// timeout OR non-zero exit → returns null; callers must translate null into 503 Service
// Unavailable (never fall through to unauth — that is the gh-CLI regression, github.com/cli/cli
// /issues/13317, we explicitly avoid).
//
// Scope of this task (GSL-260):
//   - The wrapper itself: spawn + timeout + read stdout.
//   - Env-bypass seam (config.DEV_BEARER_TOKEN) used by the smoke test.
//
// Deferred to GSL-264 per rev-3 addendum Delta 5:
//   - The `security add-generic-password -T <trusted-app>` ACL wiring (currently the wrapper only
//     READS; the writer belongs with plist.sh's install step, and plist.sh here has a TODO note).
//   - Base64-encoded shim for macOS Tahoe 26.x's -w HEX regression.
//   - Per-boot audit line into events (needs the db from GSL-261).

import { spawn } from "node:child_process";
import {
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_TIMEOUT_MS,
  DEV_BEARER_TOKEN,
} from "../config.ts";

/**
 * Read the Bearer secret from macOS Keychain. Returns the secret string on success, or `null`
 * on any failure (timeout, missing item, permission denied, non-macOS host). Callers must
 * return 503 when this is null — do NOT fall back to unauth.
 */
export async function readBearerFromKeychain(): Promise<string | null> {
  // Dev/test seam: an explicit env override skips the shell out entirely.
  if (DEV_BEARER_TOKEN.length > 0) {
    return DEV_BEARER_TOKEN;
  }

  if (KEYCHAIN_ACCOUNT.length === 0) {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    const child = spawn(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      settle(null);
    }, KEYCHAIN_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => settle(null));
    child.on("close", (code) => {
      if (code === 0) {
        // `security -w` prints the secret + trailing newline. Trim only the trailing newline;
        // the secret itself may legally contain whitespace we must not eat.
        const trimmed = stdout.replace(/\n$/, "");
        settle(trimmed.length > 0 ? trimmed : null);
      } else {
        settle(null);
      }
    });
  });
}
