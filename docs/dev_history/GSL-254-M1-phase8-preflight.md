# GSL-254 (M1 follow-up) — `publish.sh` DB preflight closes the half-published gap

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Follow-up to GSL-254 (already Done) addressing finding **M1** in verifier
`GSL-174-night/runs/01/index.html` (medium, safe/non-owner-gated). The verifier
reproduced a half-published state in a hermetic sandbox: if `publish.sh` runs
against a `GOSLEEP_DB_PATH` that lacks the `skills` table (fresh clone / corrupted
DB / migration skipped), the flow completes the rsync + JSONL append, then fails
in the fold step with `no such table: skills` (rc=1) — filesystem and JSONL are
ahead of the DB, the endpoint returns 500, and the CLI operator sees a message
that reads "the rsync ALREADY LANDED" (truthful about the rsync but misleading
about the JSONL, which did append). Production is unaffected because the
launchd-managed core migrates at boot, but standalone / dev-time use trips the
trap.

## What landed

- **`record-publish.ts` — new `check` mode.** Read-only preflight that opens the
  configured DB (respecting `GOSLEEP_DB_PATH`) and issues
  `SELECT 1 FROM skills LIMIT 1`. Exits 0 on success, 1 on failure — emits one
  structured JSON event (`skills.record-publish.check.ok` or
  `.check.fail` with the SQLite error). No mutation. Type surface: the `CliArgs.mode`
  union grew a `"check"` variant, and `parseArgs` learned the new mode.
- **`tools/skills/publish.sh` — preflight guard.** Between the existing `verify-local`
  step and the diff/confirmation banner, a new block spawns
  `bun run apps/core/scripts/record-publish.ts check`. On failure it prints a
  three-line diagnostic (what's wrong, how to fix it, the "NO filesystem changes
  were made" reassurance) and exits `rc=1`. On success the flow continues
  identically — happy path is unchanged.
- **`tools/skills/tests/preflight-smoke.sh` — new smoke.** Points `publish.sh` at
  an unmigrated scratch DB under `.artifacts/preflight-smoke/`. Asserts four
  invariants: (a) `rc != 0`, (b) the `DB preflight FAILED` or
  `skills.record-publish.check.fail` fingerprint is on stderr (so an unexpected
  failure path cannot silently satisfy the smoke), (c) the scratch backups dir is
  empty, (d) the scratch CHANGELOG.jsonl is absent. Also snapshots the production
  skill dir mtime and asserts it did not change. All five checks pass locally.

## Where the guard sits in the flow (unchanged happy path)

1. arg parsing + skill dir validation
2. CLAUDE_DANGEROUSLY_SKIP refuse
3. owner-gate (TTY or env-nonce)
4. `verify-local.sh`
5. **NEW: `record-publish.ts check` — abort here if the `skills` table is missing**
6. diff banner + confirmation prompt
7. pre-rsync backup
8. rsync `skill/<name>/ → ~/.claude/skills/<name>/`
9. `record-publish.ts write` (JSONL append + fold-to-DB)

Preflight runs read-only, before any filesystem mutation. The owner-gate stays
the first refusal — an agent-in-pipe context still bounces at step 3 with
`exit 3`, unchanged.

## Gates run before commit

- `apps/core/node_modules/.bin/tsc -p apps/core --noEmit` — clean (record-publish.ts changes).
- `bash -n tools/skills/publish.sh` — clean.
- `bash -n tools/skills/tests/preflight-smoke.sh` — clean.
- `bun test` — 228 pass / 0 fail (unchanged from tonight's baseline; preflight is
  a shell-level path, no new bun-test coverage needed beyond the smoke).
- `bash tools/lab/tests/core-smoke.sh` — 96 pass / 0 fail (unchanged; preflight
  fires only inside publish.sh, not in the server).
- `bash tools/skills/tests/preflight-smoke.sh` — 5/5 PASS (rc=1, fingerprint,
  backups empty, CHANGELOG absent, prod mtime unchanged).

## Notes

- **Autonomous decision (night session d-2026-08-09-005).** The verifier suggested
  either a runbook note OR guarding `record-publish.ts` to skip the fold gracefully
  when the table is missing. This fix does the STRONGER version: a preflight
  refusal at `publish.sh` so a broken DB never gets past the sanity gate. A
  graceful in-fold fallback would still leave a JSONL row without a DB row —
  refusing early keeps the two projections in lockstep. The runbook note
  (verifier item 4) lands as a separate GSL-254 follow-up commit.
- **No production side effects.** The launchd-managed core migrates the DB at
  boot, so its `POST /actions/skills/publish` path always finds the table.
  Preflight is a no-op there. Standalone `bash tools/skills/publish.sh …` on a
  fresh checkout now refuses politely.
- **Sanctioned autonomy per owner rule 2026-08-10 (night autonomy + unfreeze).**
  Fix + smoke landed without owner review; happy path unchanged; verifier finding
  addressed at the strongest reasonable layer.

## Runbook follow-up (verifier punch-list item 4, separate commit)

Added a new **section 10 — Skills publishing (`publish.sh` — GSL-254 / GSL-306)**
to `docs/runbooks/gosleep-core.md` (shifting the former section 10 "Standing
rules" to 11). The section names the "standalone use must migrate first" rule
explicitly, gives the two-line operator command (`bun run apps/core/scripts/migrate.ts`
then `bash tools/skills/publish.sh <name>`), and points at
`tools/skills/tests/preflight-smoke.sh` as the assertion. English, no
section-sign glyph (project rule 2026-07-20 — only the three pre-existing
`§` occurrences elsewhere in the runbook remain, untouched).
