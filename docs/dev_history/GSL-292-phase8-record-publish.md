# GSL-292 (T4) — record-publish.ts writer

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

## What landed

- `apps/core/scripts/record-publish.ts` — the missing writer for the `skills` table (schema present since GSL-263; empty until now because no code populated it — the exact defect verifier ticket GSL-292 named).
- Two modes:
  - `fold` — full re-fold of `docs/skills/CHANGELOG.jsonl` → `skills` table.
  - `write --skill … --task … --commit … --lesson … [--status …] [--intent-id …]` — validate + append one JSONL row + re-fold.
- Projection shape per `skill`: `version = sha-<first 8 chars of latest published commit>` (or `"0.0.0"` on no publishes), `status = "published" | "clean"`, `last_published_at`, `last_published_by = "owner-web"` when the row has a non-null intent_id else `"owner-cli"`, `changelog = full JSON array`.
- Placeholder rows for every skill in `KNOWN_SKILLS` even without a JSONL entry — so `/skills` returns the full seven-row set for the Skills screen (per plan risk 5, "seven skills asymmetry — tmux-agents-orchestration is production-only until stage 1").
- Env overrides `GOSLEEP_DB_PATH` + `GOSLEEP_CHANGELOG_PATH` for hermetic smoke.
- Same validation code path (`validateRow`) applies on read and on append — publish.sh (T3) will delegate the append via `bun run … write`.

## Live-proof (scratch DB under `.artifacts/impl-174/scratch/`)

- Migrated scratch DB → 7 tables + skills empty.
- Seeded CHANGELOG.jsonl with two rows (handoff w/ intent_id, delivery-workflow w/ null intent_id).
- `fold` → 2 scanned, 7 upserted; DB shows handoff `sha-11111111 published owner-web`, delivery-workflow `sha-22222222 published owner-cli`, five placeholders.
- `write --skill writing-prds --task GSL-189 --commit 33… --intent-id 01H-web-def` → appended a valid row, re-folded, DB shows writing-prds `sha-33333333 published owner-web` alongside the previous two.
- `validate-changelog.sh` against the 3-row scratch JSONL → rc=0 (all rows valid).
- `--bogus` flag → `{"event":"skills.record-publish.error","error":"unknown flag: --bogus"}`, exit non-zero.

## Design notes

- **JSONL is authoritative (PRD R8.5).** This script never fabricates a publish row; `write` appends exactly one keyed by the caller's arguments.
- **Idempotent fold.** Re-running `fold` gives the same table state — the upsert is keyed on `name`. Safe to call from boot (out of scope tonight to wire the boot hook; publish.sh will call the writer explicitly per publish).
- **`last_published_by` derivation.** The JSONL schema does not carry an explicit `by` field yet; the derivation from `intent_id` is unambiguous enough for tonight. A future schema bump may add `by`.
- **Typecheck clean.** `bun x tsc -p apps/core --noEmit` exits 0.

## Follow-ups

- T3 (publish.sh) calls this script at the end of a successful rsync to append the published row + refresh the DB.
- T6 (`GET /skills/:name/diff`) reads the same projection to enrich the UI-facing status with the filesystem-derived `has-changes | clean` computed at read time.
