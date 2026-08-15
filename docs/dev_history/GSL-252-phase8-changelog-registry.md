# GSL-252 — [Skill][Docs] Skills management CHANGELOG registry

**Date:** 2026-08-10 · **Commit:** `fc23bc9` · **Branch:** `GSL-174-skills-management`

## What landed

- `docs/skills/CHANGELOG.jsonl` — empty append-only source of truth for skill publishes.
- `docs/skills/README.md` — row shape + validation + backup convention.
- `tools/skills/schema/changelog.schema.json` — draft-07 schema (6 required fields, optional `intent_id`).
- `tools/skills/validate-changelog.sh` — bash+python3 validator, exit codes 0/1/2, `VERBOSE=1` for PASS lines.
- `tools/lab/smoke.sh` — new opt-in `GSL-252` gate behind `GOSLEEP_SKILLS_GUARD=1` with a real+mutant pair so the guard is proven to actually look at the file.

## Live-proof (this worker ran it)

- Empty file → `rc=0` silent (fresh clone case).
- Valid row → `PASS row 1`, `rc=0`.
- Missing `status` field → `FAIL row 1: missing required field(s): ['status']`, `rc=1`.
- Unknown skill enum → `FAIL row 1: 'skill' must be one of [...]`, `rc=1`.
- 6-char commit SHA → `FAIL row 1: 'commit' must be a 40-char lowercase git SHA`, `rc=1`.

## Design notes

- **`intent_id` optional but recommended.** The production test-guard (T10) keys on `intent_id` to correlate a filesystem mutation with a legitimate publish (per plan risk 3, "matching CHANGELOG row must key on intent_id, not any published row in this run"). CLI-only publishes may leave it `null`; web-endpoint publishes always populate it.
- **Enum of 7 skills.** Matches the current owned set. New skills land additively in the same commit that publishes them.
- **JSONL over SQL.** Governance plan section 6 makes JSONL the source of truth; `skills` table is the projection (T4). This mirrors the events → SQLite pattern in Phase 7.
- **Opt-in guard.** `GOSLEEP_SKILLS_GUARD=1` gates the smoke check tonight — the always-on flip lands after `GSL-251` reverse-syncs the drift and eliminates false-positive risk from the authoritative-copy-in-production state.

## Follow-ups

- T4 (GSL-292): `record-publish.ts` populates the `skills` table by reading this JSONL.
- T10 (GSL-254 rest): production test-guard uses the schema + intent_id correlation.
