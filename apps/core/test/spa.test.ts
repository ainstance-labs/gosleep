// @gosleep/core — SPA route (GSL-285) unit tests.
//
// The functional / end-to-end coverage lives in `tools/lab/tests/core-smoke.sh` scenarios
// 51-58 (static asset served, index.html fallback, API precedence, CSP still stamped, wrong
// Host still 421, POST-to-unknown still honestly 404s). These tests cover the pure helper —
// `resolveWebDistRoot()` — that decides which dist directory to serve from. The helper is
// env-driven and re-runs on module load; here we exercise every branch in isolation.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveWebDistRoot } from "../src/routes/spa.ts";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

function makeScratchDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsl285-dist-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><body>ok</body></html>");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "app.js"), "console.log('spa')");
  return dir;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GOSLEEP_WEB_DIST;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  try {
    process.chdir(ORIGINAL_CWD);
  } catch {
    /* ignore */
  }
});

describe("resolveWebDistRoot (GSL-285)", () => {
  test("env override wins when the path exists", () => {
    const dir = makeScratchDist();
    try {
      process.env.GOSLEEP_WEB_DIST = dir;
      const resolved = resolveWebDistRoot();
      expect(resolved).toBe(resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("env override returns null when the path does NOT exist — no silent fallback", () => {
    // A caller who set the override MUST have meant it; falling back to `apps/web/dist`
    // would mask a typo. The route mounts the placeholder page instead.
    process.env.GOSLEEP_WEB_DIST = join(tmpdir(), `gsl285-missing-${Date.now()}`);
    const resolved = resolveWebDistRoot();
    expect(resolved).toBeNull();
  });

  test("env override rejects a file (non-directory) — placeholder path wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "gsl285-file-"));
    const filePath = join(dir, "not-a-dir");
    writeFileSync(filePath, "content");
    try {
      process.env.GOSLEEP_WEB_DIST = filePath;
      const resolved = resolveWebDistRoot();
      expect(resolved).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cwd-relative default: repo root cwd finds apps/web/dist", () => {
    // Simulate the launchd shape (cwd = repo root, apps/web/dist a real subtree). We build
    // both `apps/web/dist` and `apps/core/src` under a scratch root, then chdir into the
    // scratch root to make the default probe land on the fixture — never the real repo dist.
    const scratchRoot = mkdtempSync(join(tmpdir(), "gsl285-cwd-"));
    try {
      const distPath = join(scratchRoot, "apps/web/dist");
      mkdirSync(distPath, { recursive: true });
      writeFileSync(join(distPath, "index.html"), "fixture");
      process.chdir(scratchRoot);
      const resolved = resolveWebDistRoot();
      // macOS resolves /tmp → /private/tmp under process.cwd(); compare via realpathSync so
      // the symlink normalisation on both sides matches.
      expect(resolved).not.toBeNull();
      expect(realpathSync(resolved!)).toBe(realpathSync(distPath));
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  });

  test("returns null when neither the env override nor any default candidate exists", () => {
    // A directory with nothing on any of the three probe paths should decline to serve —
    // the mount then renders the "bundle missing" placeholder honestly.
    const empty = mkdtempSync(join(tmpdir(), "gsl285-empty-"));
    try {
      process.chdir(empty);
      const resolved = resolveWebDistRoot();
      expect(resolved).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("symlinked dist under env override still resolves (real deploy shape)", () => {
    // Sanity: production deploys sometimes symlink `apps/web/dist` at the top of a release.
    const real = makeScratchDist();
    const link = join(tmpdir(), `gsl285-link-${Date.now()}`);
    try {
      symlinkSync(real, link, "dir");
      process.env.GOSLEEP_WEB_DIST = link;
      const resolved = resolveWebDistRoot();
      // The resolver keeps the caller-provided path (does not canonicalise); the file
      // existence check follows the symlink so a real deploy shape works out of the box.
      expect(resolved).toBe(resolve(link));
    } finally {
      try {
        rmSync(link, { force: true });
      } catch {
        /* ignore */
      }
      rmSync(real, { recursive: true, force: true });
    }
  });
});
