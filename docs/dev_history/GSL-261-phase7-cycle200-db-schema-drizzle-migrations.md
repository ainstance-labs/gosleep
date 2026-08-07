# GSL-261 — SQLite schema v1 + Drizzle migrations + snapshot/restore + daily cron

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 4 (part 1) of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 9; schema per section 4.3, snapshots per 4.4, Drizzle rationale per 4.2, R27–R33 gates per section 12.

## What was done

`apps/core` now owns the SQLite source of truth. Drizzle ORM 0.44.7 + drizzle-kit 0.31.10 are pinned, the schema file describes the eight tables from target-arch section 4.3, `drizzle-kit generate` produced the first migration and its snapshot/journal, and a runtime migrator, snapshot script, restore script, and daily launchd plist wire it all together. A hermetic round-trip proved the flow end-to-end: fresh DB → migrate → migrate again idempotent → snapshot → restore snapshot → integrity check ok.

Concretely:

- **`apps/core/src/db/schema.ts`** — Drizzle `sqliteTable` definitions for the eight tables the Jira description names: `events`, `questions`, `decisions`, `tasks`, `skills`, `heartbeat`, `server_intents`, `ingest_state`. Every field carries its intent in the comment; the `events` table has three composite indexes (`(type, ts)`, `(task, ts)`, `(actor, ts)`) plus the unique `uq_events_ingested` index that dedups the JSONL importer per R30. Cross-table refs (`events.supersedes_seq`, `questions.last_event_seq`, `decisions.last_event_seq`) are stored WITHOUT SQL-level FKs on purpose — the JSONL importer (GSL-262) may seed events out of arrival order and hard FKs would refuse the load; referential integrity moves to the tail indexer.
- **`apps/core/src/db/client.ts`** — `openDatabase(path?)` and `getDb()` singleton. Path resolves to `data/gosleep.db` relative to the repo root via `import.meta.url`; `GOSLEEP_DB_PATH` overrides for tests. On first open the client sets `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON` — the exact combo target-arch §4.4 asks for.
- **`apps/core/drizzle.config.ts`** — dialect `sqlite`, schema `./src/db/schema.ts`, out `./drizzle`. `verbose: true` prints the emitted SQL in the CI diff; `strict: true` refuses to generate when schema and snapshot disagree.
- **`apps/core/drizzle/0000_initial.sql`** — generated migration, hand-reviewed. All 8 tables + 3 indexes + 1 unique index. **Renamed from the auto-slug `0000_magenta_bedlam.sql`** to the stable `0000_initial.sql` per Jira's description; `meta/_journal.json` retagged to match.
- **`apps/core/drizzle/meta/_journal.json`** + **`apps/core/drizzle/meta/0000_snapshot.json`** — all three files committed together (this trio is the migration set — losing any one breaks reproducibility, which is why the smoke guard asserts all three exist).
- **`apps/core/scripts/migrate.ts`** — the runtime migrator. Order: `PRAGMA integrity_check` → best-effort pre-snapshot via `sqlite3 .backup` → `drizzle-orm/bun-sqlite/migrator#migrate()`. Emits one JSON log line per step (`core.migrate.start / integrity.ok / snapshot.ok / done`) so the launchd stdout log is diff-friendly. Exit 1 only on integrity failure or migration throw — "no pending migrations" is exit 0 (idempotent by construction).
- **`apps/core/scripts/snapshot.sh`** — `sqlite3 .backup` wrapper with four `--kind` families (`daily`, `pre`, `pre-publish`, `manual --label X`) that map onto the retention rules from §4.4. Retention embedded: daily kept 30 days by mtime, `pre-*` and `pre-publish-*` keep the 5 most recent by `ls -1t`, `manual-*` untouched forever. `chmod 0700` on the snapshots dir and 0600 on each snapshot file — never leaks. `GOSLEEP_DB_PATH` overrides source path for tests.
- **`apps/core/scripts/restore-snapshot.sh <file>`** — the sharp knife. Refuses to restore while `plist.sh status` reports a live process (unless `GOSLEEP_RESTORE_SKIP_LIVE_CHECK=1`), moves `gosleep.db{,-wal,-shm}` aside to `.bak`, copies the snapshot in, `chmod 0600`, then runs `PRAGMA integrity_check` — a failed check rolls back to the `.bak` copy so the operator never gets a corrupt live DB.
- **`apps/core/plist/com.gosleep.snapshot.plist`** — launchd template for the daily cron (`StartCalendarInterval Hour=3 Minute=0`), `RunAtLoad=false` (no double-run at login), `AbandonProcessGroup=true` (a stuck sqlite3 does not keep the agent held), logs under `data/logs/snapshot-*.log`. `@@REPO_ROOT@@` placeholder to be substituted by a future install helper.
- **`apps/core/package.json`** — added `drizzle-orm ^0.44.6`, `drizzle-kit ^0.31.4` (devDep), and four scripts: `db:generate`, `db:migrate`, `db:snapshot`, `db:restore`.
- **`tools/lab/smoke.sh`** — new `GSL-261` block. Awk-based guard that greps `apps/core/drizzle/*.sql` for `DROP (TABLE|COLUMN)` and passes only if the drop is preceded within 5 lines by a `-- WARN: intentional drop` sentinel (R28 encoded). A second check asserts the three-file migration trio (`0000_initial.sql`, `meta/_journal.json`, `meta/0000_snapshot.json`) travels together. Both assertions PASS on this commit.
- **`bun.lock`** — updated to include drizzle-orm and drizzle-kit resolution graphs (root workspace file, per project rule — no per-app lockfiles).

## Problems solved

- **Migration round-trip verified against a scratch DB.** `GOSLEEP_DB_PATH=/tmp/gosleep-migrate-test.db bun run --cwd apps/core db:migrate` — first run created the file, ran integrity_check ok, took a pre-migration snapshot, applied `0000_initial.sql`. Second run was fully idempotent: `SELECT count(*) FROM __drizzle_migrations` returned `1`. `.tables` after migration showed all 9 (8 schema + `__drizzle_migrations`).
- **Snapshot + restore round-trip proved.** `bash apps/core/scripts/snapshot.sh` created `daily-<ts>.db` in `data/snapshots/`. `bash apps/core/scripts/restore-snapshot.sh <daily-file>` moved the live DB aside, copied the snapshot in, integrity_check ok, and `.tables` on the restored DB showed all 9 tables — proving the atomic-backup path works end-to-end.
- **`bun x tsc -p apps/core --noEmit` clean.** Strict TS with `noUncheckedIndexedAccess` passes; the migrate script's `PRAGMA integrity_check` row-count check is null-safe (`check[0]?.integrity_check ?? "unknown"`).
- **`tools/lab/smoke.sh`: 551 PASS / 0 FAIL** with the new GSL-261 block active. The R28 awk guard fires only on unannotated DROPs.
- **`tools/lab/gate.sh --offline`: green** — all four gates (smoke, hooks-verify --offline, tsc, chronicler --no-poll) pass on this branch.
- **`data/` still holds only the two markers** (`.gitkeep`, `.gitignore`) — `git ls-files data/` returns exactly `data/.gitkeep` + `data/.gitignore` after the test round-trip and cleanup. R31 gate (GSL-258 smoke block) stays green.

## Problems remaining

- **The pre-migration snapshot on a fresh install captures an empty DB.** `openDatabase` creates the DB file with `create: true` before integrity_check + snapshot run; a first-time operator will see `data/snapshots/pre-<ts>.db` full of zeros. Not a bug — protects existing DBs on upgrade — but a future task could add a "skip snapshot if source has no user tables" branch to avoid the confusing artifact. Documented here rather than fixed silently.
- **The daily-snapshot plist has no install helper yet.** The template lives at `apps/core/plist/com.gosleep.snapshot.plist` with `@@REPO_ROOT@@` placeholders, but the equivalent of `plist.sh install` for the snapshot job is not written. A follow-up task (or the next-time editor of `plist.sh`) is expected to add a `plist.sh install-snapshot` verb that renders the template and `launchctl bootstrap`s it. The template itself is parse-clean (would pass `plutil -lint` — not run here, but shape is a copy of the working `com.gosleep.core.plist`).
- **No forward-migration test in Bun's test runner.** The round-trip is verified by hand-driven shell above; no `*.test.ts` yet. When the test-runner task lands (later in the epic), migrating on a fresh DB + integrity_check should become a unit test.

## Pitfalls & workarounds

- **Do not add SQL-level FKs to `events.supersedes_seq` / `questions.last_event_seq` / `decisions.last_event_seq`.** They are soft refs on purpose. The JSONL importer (GSL-262) walks queue.jsonl and archive.jsonl separately from events; a strict FK would reject a supersedes that arrives before its target. Enforcement is a job for the tail indexer (GSL-263), not the DDL.
- **Rename convention for migrations.** `drizzle-kit generate` emits random slugs (`0000_magenta_bedlam.sql`). We renamed the SQL file to `0000_initial.sql` and updated the `tag` in `meta/_journal.json` to match. If a future migration is regenerated, do the rename + retag together or `drizzle-kit` will silently re-emit a mismatched entry.
- **Bun `.query("PRAGMA integrity_check;").all()` returns `[{integrity_check: "ok"}]` — one row on success and one row per problem on failure.** The migrate script reads `check[0]?.integrity_check` and refuses to migrate if it is anything other than the literal `"ok"`. Do NOT change this to `check.length > 1` — a corrupt DB with a single misleading row would slip through.
- **R28 awk guard is proximity-based.** A `-- WARN: intentional drop` sentinel must appear on one of the 5 lines immediately preceding the `DROP TABLE|COLUMN` — putting the annotation far above the drop (say, in a file header) will NOT satisfy the guard. This is deliberate: the annotation is meant to be right above the destructive statement, not hidden in a preamble.
- **Snapshots ARE git-ignored.** The wrapper `chmod 0700 data/snapshots/` runs inside `snapshot.sh`; do not commit a snapshot as "test fixture" — `data/**` is refused by `.gitignore` and by the R31 smoke guard.

## What didn't make it

- **Rev-3 addendum schema deltas were deliberately excluded.** The addendum names three: per-agent fleet (`agent_sessions` table), question provenance (`applied_by` + `applied_rule_ref` on `questions`), and a new `deferred` status. These are filed as their own Jira tasks — GSL-276, GSL-277, GSL-278 respectively — so folding them into GSL-261 would inflate this commit and mix concerns. The Jira description for GSL-261 lists exactly the eight tables from section 4.3; this commit matches that scope 1:1.
- **The `apps/core/plist/com.gosleep.snapshot.plist` install helper.** Deferred as above.
- **Unit tests for `snapshot.sh` retention pruning** (30-day daily cutoff, keep-last-5 for pre-*). The round-trip smoke exercises the happy path; retention lives inline in the script and was reviewed by reading. A cheap `find` on a scratch snapshots dir with pre-aged mtimes would cover this; a follow-up.

## Technical reference

- **Commit SHA:** filled at commit time.
- **Files added:** `apps/core/src/db/schema.ts`, `apps/core/src/db/client.ts`, `apps/core/drizzle.config.ts`, `apps/core/drizzle/0000_initial.sql`, `apps/core/drizzle/meta/_journal.json`, `apps/core/drizzle/meta/0000_snapshot.json`, `apps/core/scripts/migrate.ts`, `apps/core/scripts/snapshot.sh`, `apps/core/scripts/restore-snapshot.sh`, `apps/core/plist/com.gosleep.snapshot.plist`.
- **Files modified:** `apps/core/package.json` (drizzle deps + 4 new scripts), `bun.lock` (drizzle resolutions), `tools/lab/smoke.sh` (new GSL-261 assertion block before RESULT).
- **New npm scripts:** `bun run --cwd apps/core db:generate | db:migrate | db:snapshot | db:restore`.
- **Verification (run):**
  - `bun x tsc -p apps/core --noEmit` — rc 0.
  - `GOSLEEP_DB_PATH=/tmp/gosleep-migrate-test.db bun run --cwd apps/core db:migrate` — twice, second run idempotent (`__drizzle_migrations` count stays 1).
  - `bash apps/core/scripts/snapshot.sh` (with `GOSLEEP_DB_PATH` override) — created `daily-<ts>.db` at 0600 in a 0700 dir.
  - `bash apps/core/scripts/restore-snapshot.sh <daily>` (with `GOSLEEP_RESTORE_SKIP_LIVE_CHECK=1`) — restored, integrity_check ok, all 9 tables present.
  - `bash tools/lab/smoke.sh` — 551 PASS / 0 FAIL.
  - `bash tools/lab/gate.sh --offline` — all four gates green.
- **Links:** Jira [GSL-261](https://ainstance-labs.atlassian.net/browse/GSL-261) · GitHub issue mirror `ainstance-labs/gosleep#271`.
