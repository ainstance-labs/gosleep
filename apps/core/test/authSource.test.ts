// @gosleep/core — auth-source fallback chain tests (GSL-264, rev-3 addendum Delta 5).
//
// Verifies the Delta-5 chain (dev-env → keychain → GOSLEEP_TOKEN_PATH → nothing) exercises
// each rung under a variety of failure modes, and that the resolver NEVER silently degrades
// to plain-text unless the operator explicitly configured GOSLEEP_TOKEN_PATH.
//
// The Keychain rung is not exercised directly here (the test would depend on the host's real
// Keychain contents; that lives in tools/lab/tests/keychain-roundtrip.sh — a live-macOS integration
// test kept out of the hermetic unit run). We DO exercise:
//   - dev-env bypass wins over everything.
//   - When Keychain is unreachable AND GOSLEEP_TOKEN_PATH is set → token-file rung used.
//   - When Keychain is unreachable AND GOSLEEP_TOKEN_PATH is NOT set → source='none' (503).
//   - Base64 in the token-file is transparently decoded (matches Keychain shape).
//   - Corrupted b64v1 token file → source='none' (no silent fallback to raw).
//   - Boot audit line written to stderr in JSON with the expected shape.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_ENV = { ...process.env };

async function importFreshAuth(): Promise<
  typeof import("../src/security/authSource.ts")
> {
  // The auth chain reads config module-level constants — bust the module cache so each test
  // sees its own env. Bun's ESM cache is per-URL; adding a query string makes it a fresh URL.
  const url = new URL("../src/security/authSource.ts", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<typeof import("../src/security/authSource.ts")>;
}

async function importFreshConfig(): Promise<typeof import("../src/config.ts")> {
  const url = new URL("../src/config.ts", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<typeof import("../src/config.ts")>;
}

async function importFreshKeychain(): Promise<
  typeof import("../src/security/keychain.ts")
> {
  const url = new URL("../src/security/keychain.ts", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<typeof import("../src/security/keychain.ts")>;
}

function resetEnv(): void {
  // Restore the baseline, then wipe any keys the tests set.
  const currentKeys = Object.keys(process.env);
  for (const k of currentKeys) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v !== undefined) process.env[k] = v;
  }
}

describe("resolveAuthSource — fallback chain", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetEnv();
    tmpDir = mkdtempSync(join(tmpdir(), "gosleep-auth-src-"));
    // Force the Keychain rung to fail by pointing at an account name we know does not exist
    // on any host. Every test explicitly UNSETS this if it wants the dev-env rung instead.
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "";
    delete process.env.GOSLEEP_BEARER_TOKEN;
    delete process.env.GOSLEEP_TOKEN_PATH;
    process.env.GOSLEEP_PLATFORM_OVERRIDE = "25"; // non-Tahoe by default
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    resetEnv();
  });

  test("dev-env bypass wins even when Keychain would succeed", async () => {
    process.env.GOSLEEP_BEARER_TOKEN = "dev-token-xyz";
    // Even if the account is set — dev-env short-circuits first.
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "some-real-user";

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBe("dev-token-xyz");
    expect(r.source).toBe("dev-env");
    expect(r.fallback).toBe("none");
    expect(r.auditLine).toContain("auth-source: dev-env");
  });

  test("no keychain (no-account), no token-file → source='none' (503)", async () => {
    // Both rungs unreachable + no explicit fallback env → we DO NOT invent a fallback.
    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBeNull();
    expect(r.source).toBe("none");
    expect(r.fallback).toContain("keychain=no-account");
  });

  test("no keychain but token-file set → source='token-file'", async () => {
    const p = join(tmpDir, "token.txt");
    writeFileSync(p, "file-secret-abc\n", "utf8");
    process.env.GOSLEEP_TOKEN_PATH = p;

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBe("file-secret-abc");
    expect(r.source).toBe("token-file");
    expect(r.fallback).toContain("keychain=no-account");
    expect(r.auditLine).toContain("auth-source: token-file");
  });

  test("token-file may itself be b64v1-encoded (matches Keychain shape)", async () => {
    // Encode 'my-file-secret' as b64v1:...
    const { encodeSecret } = await import("../src/security/tokenEncoding.ts");
    const p = join(tmpDir, "token.b64");
    writeFileSync(p, encodeSecret("my-file-secret"), "utf8");
    process.env.GOSLEEP_TOKEN_PATH = p;

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBe("my-file-secret");
    expect(r.source).toBe("token-file");
  });

  test("token-file set but empty → source='none' (never silently allows)", async () => {
    const p = join(tmpDir, "empty.txt");
    writeFileSync(p, "", "utf8");
    process.env.GOSLEEP_TOKEN_PATH = p;

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBeNull();
    expect(r.source).toBe("none");
    expect(r.fallback).toContain("token-file=missing-or-invalid");
  });

  test("token-file b64v1 corruption → source='none' (integrity FAILS closed)", async () => {
    const p = join(tmpDir, "corrupt.txt");
    writeFileSync(p, "b64v1:!!!not-valid!!!", "utf8");
    process.env.GOSLEEP_TOKEN_PATH = p;

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBeNull();
    expect(r.source).toBe("none");
  });

  test("token-file path does not exist → source='none'", async () => {
    process.env.GOSLEEP_TOKEN_PATH = join(tmpDir, "does-not-exist");

    const { resolveAuthSource } = await importFreshAuth();
    const r = await resolveAuthSource();

    expect(r.secret).toBeNull();
    expect(r.source).toBe("none");
  });
});

describe("resolveAuthSource — Tahoe timeout floor", () => {
  beforeEach(() => {
    resetEnv();
    delete process.env.GOSLEEP_BEARER_TOKEN;
    delete process.env.GOSLEEP_TOKEN_PATH;
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "";
  });

  afterEach(() => resetEnv());

  test("Tahoe (26.x) floors the Keychain timeout to 5000 even when the config sets a lower value", async () => {
    process.env.GOSLEEP_PLATFORM_OVERRIDE = "26";
    process.env.GOSLEEP_KEYCHAIN_TIMEOUT_MS = "200";
    // Force a Keychain call by giving an account name; the shell-out will fail (no such item),
    // returning quickly, but the timeout FLOOR is what we're asserting.
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "gosleep-test-nonexistent";

    const { readKeychainSecret } = await importFreshKeychain();
    const kc = await readKeychainSecret();

    expect(kc.timeoutMs).toBe(5000);
  });

  test("Non-Tahoe (25.x) respects a lower configured timeout", async () => {
    process.env.GOSLEEP_PLATFORM_OVERRIDE = "25";
    process.env.GOSLEEP_KEYCHAIN_TIMEOUT_MS = "1200";
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "gosleep-test-nonexistent";

    const { readKeychainSecret } = await importFreshKeychain();
    const kc = await readKeychainSecret();

    expect(kc.timeoutMs).toBe(1200);
  });
});

describe("writeAuthSourceAudit — stderr JSON line", () => {
  beforeEach(() => {
    resetEnv();
    delete process.env.GOSLEEP_BEARER_TOKEN;
    delete process.env.GOSLEEP_TOKEN_PATH;
    process.env.GOSLEEP_KEYCHAIN_ACCOUNT = "";
    process.env.GOSLEEP_PLATFORM_OVERRIDE = "25";
  });

  afterEach(() => resetEnv());

  test("emits a JSON line with the expected top-level keys", async () => {
    const captured: string[] = [];
    const original = console.error;
    // eslint-disable-next-line no-console
    console.error = (...args: unknown[]): void => {
      captured.push(args.map((a) => String(a)).join(" "));
    };

    try {
      const { writeAuthSourceAudit } = await importFreshAuth();
      await writeAuthSourceAudit(null); // db=null → skip the events insert, still logs
    } finally {
      // eslint-disable-next-line no-console
      console.error = original;
    }

    // Find the audit line among captured lines.
    const auditLine = captured.find((l) => l.includes("core.security.auth-source-audit"));
    expect(auditLine).toBeDefined();
    const parsed = JSON.parse(auditLine ?? "{}") as Record<string, unknown>;
    expect(parsed.event).toBe("core.security.auth-source-audit");
    expect(typeof parsed.source).toBe("string");
    expect(typeof parsed.fallback).toBe("string");
    expect(typeof parsed.tahoe).toBe("boolean");
    expect(typeof parsed.line).toBe("string");
  });
});

// Silence the "unused" warning if the config re-import helper is dropped later.
void importFreshConfig;
