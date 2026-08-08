# GSL-294 [Repo][Web] /version.db_schema_version = drizzle journal hash

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-263 (/version).

## Part 1 — the story

`GET /version.db_schema_version` used to return the string `"unset"` — a placeholder
GSL-263 declared honest at the time and marked deferred. The verifier noted that
target-architecture rev 2 §3.4 pinned the field as the drizzle-journal hash so a
rolling schema change is observable from the browser (target-arch §12 R34: "reload
the tab on schema mismatch"). Never landed.

Fix: compute a SHA-256 over the drizzle journal (`apps/core/drizzle/meta/_journal.json`)
plus every migration `NNNN_*.sql` file in filename order, take the first 16 hex chars.
Read once at boot, memoise, expose via a `getDbSchemaVersion()` accessor. The full
64-hex digest is available via `computeDbSchemaVersion({ full: true })` for anyone who
wants extra entropy.

Deterministic + read-only: same on-disk files → same hash across restarts. Any change
to the journal, or to any migration file, or the addition of a new migration, changes
the hash. Missing drizzle directory falls back to `"unavailable"` (never throws / 500s).
Env override `GOSLEEP_DB_SCHEMA_VERSION_OVERRIDE` for tests that want deterministic
output.

## Part 2 — the reference

- **Commit:** GSL-294 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/core/src/db/schemaVersion.ts` — NEW. `computeDbSchemaVersion`, `resolveDrizzleDir`,
    `getDbSchemaVersion` (memoised), `__resetDbSchemaVersionCache` (test hook).
  - `apps/core/src/routes/read.ts` — /version now returns `getDbSchemaVersion()` instead of
    the hardcoded `"unset"` placeholder; comment cites target-arch §12 R34.
  - `apps/core/src/config.ts` — replaced the deferred-placeholder comment with a pointer to
    the new module + env override doc.
  - `apps/core/test/schemaVersion.test.ts` — NEW. 8 unit tests: determinism, full-vs-short
    digest, changed migration → changed hash, changed journal → changed hash, added migration
    → changed hash, missing dir → "unavailable", env override wins, memo caches the result.
  - `tools/lab/tests/core-smoke.sh` — scenario 6c asserts `db_schema_version` matches the
    16-hex regex (never the legacy `unset` string).
- **Verified by running:**
  - `bun test apps/core/test/schemaVersion.test.ts` → 8/8.
  - `bun test apps/core` → 191 pass.
  - `bash tools/lab/tests/core-smoke.sh` → 89 pass, 0 fail (was 88 pre-change).
  - `bun x tsc -p apps/core --noEmit` → clean.
  - Live: `curl -s -H 'Authorization: Bearer scratch-tok' http://127.0.0.1:7331/version` →
    `{"server_version":"0.0.1","api_versions":["v1"],"db_schema_version":"..."}` where
    the value matches `[0-9a-f]{16}`.
- **Links:** Jira [GSL-294](https://ainstance-labs.atlassian.net/browse/GSL-294),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
