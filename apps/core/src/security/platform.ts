// @gosleep/core — macOS platform probe (GSL-264, rev-3 addendum Delta 5).
//
// A tiny, memoized detector for the platform facts the auth layer branches on:
//   - `darwinMajor`   — the Darwin kernel major from `os.release()` (`26.x.x` on macOS Tahoe 26,
//                       `25.x.x` on Sequoia 15, and so on). Runs zero shell-outs.
//   - `productVersion`— optional `sw_vers -productVersion` output (best-effort; if the shell-out
//                       fails or takes too long we return null and rely on the Darwin major).
//   - `isTahoe`       — `darwinMajor >= 26` OR `productVersion` starts with `26.` — the
//                       Delta-5 regression guard flips on either signal, whichever wins.
//   - `uptimeSeconds` — `os.uptime()` — the audit line needs to know if this is a fresh boot
//                       (Delta 5 requires the auth-source line ONLY when uptime < 5 min so it
//                       does not spam every launchd restart).
//
// EVERYTHING IS SYNCHRONOUS. The detector runs once per process (memoized) and its result never
// changes — the OS does not upgrade under our feet at runtime. A test seam
// (`GOSLEEP_PLATFORM_OVERRIDE=<major>`) lets the test suite exercise both Tahoe and non-Tahoe
// branches on any host.
//
// DEFENSIVE DEFAULT. On non-Darwin (Linux CI, weird test env), we return `darwinMajor=0` and
// `isTahoe=false`. The caller still enforces the 5-second timeout ceiling regardless, so the
// Tahoe branch is only additive; missing detection cannot silently downgrade auth.

import { release, uptime, platform } from "node:os";
import { spawnSync } from "node:child_process";

export interface PlatformInfo {
  os: NodeJS.Platform;
  darwinMajor: number;
  productVersion: string | null;
  isTahoe: boolean;
  isDarwin: boolean;
  uptimeSeconds: number;
}

let cached: PlatformInfo | null = null;

function parseDarwinMajor(rel: string): number {
  // `os.release()` on Darwin returns strings like "26.0.0" or "25.6.0". The first dotted segment
  // is the kernel major; a non-numeric leading segment collapses to 0 (defensive; not expected
  // on any supported host).
  const first = rel.split(".", 1)[0] ?? "";
  const n = Number.parseInt(first, 10);
  return Number.isFinite(n) ? n : 0;
}

function readProductVersion(): string | null {
  // Best-effort. Timeout at 500ms — we are already inside process start; a hung `sw_vers` must
  // never wedge boot. On any failure return null and let the Darwin-major branch decide.
  try {
    const out = spawnSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
      timeout: 500,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (out.status !== 0 || typeof out.stdout !== "string") return null;
    const trimmed = out.stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Return the platform info; memoized after first call. */
export function getPlatformInfo(): PlatformInfo {
  if (cached !== null) return cached;

  const override = process.env.GOSLEEP_PLATFORM_OVERRIDE;
  if (typeof override === "string" && override.length > 0) {
    // Test seam. Value is the Darwin major (e.g. "26" for Tahoe, "25" for Sequoia).
    const overrideMajor = Number.parseInt(override, 10);
    const isTahoe = Number.isFinite(overrideMajor) && overrideMajor >= 26;
    cached = {
      os: platform(),
      darwinMajor: Number.isFinite(overrideMajor) ? overrideMajor : 0,
      productVersion: process.env.GOSLEEP_PRODUCT_VERSION_OVERRIDE ?? null,
      isTahoe,
      isDarwin: platform() === "darwin",
      uptimeSeconds: uptime(),
    };
    return cached;
  }

  const os = platform();
  const isDarwin = os === "darwin";
  const darwinMajor = isDarwin ? parseDarwinMajor(release()) : 0;
  const productVersion = isDarwin ? readProductVersion() : null;
  const productTahoe = productVersion !== null && productVersion.startsWith("26.");
  const isTahoe = isDarwin && (darwinMajor >= 26 || productTahoe);

  cached = {
    os,
    darwinMajor,
    productVersion,
    isTahoe,
    isDarwin,
    uptimeSeconds: uptime(),
  };
  return cached;
}

/**
 * ONLY used by tests that need to re-detect after mutating `GOSLEEP_PLATFORM_OVERRIDE`.
 * Never called in production paths — the platform does not change at runtime.
 */
export function _resetPlatformInfoForTests(): void {
  cached = null;
}
