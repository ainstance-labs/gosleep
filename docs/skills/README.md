# Skills management registry

**Owner:** Roman L · **Project:** GSL (gosleep) · **Epic:** [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) · **Phase 8 PRD:** [`docs/prd/02-phase8-skills-management.md`](../prd/02-phase8-skills-management.md)

This directory carries the **append-only** history of skill publishes. It is the source of truth for what has been published to `~/.claude/skills/<name>/` — the SQLite `skills` table is a projection populated by `apps/core/scripts/record-publish.ts` (task GSL-292, T4 of the tonight-buildable slice).

## Layout

- `CHANGELOG.jsonl` — one row per publish (append-only JSONL).
- `schema/changelog.schema.json` — machine-readable schema (draft-07); consumed by `tools/skills/validate-changelog.sh`.
- `backups/<name>-<utc-ts>/` — per-publish snapshot of the pre-rsync production tree (created by `tools/skills/publish.sh` before the rsync). See risk 6 in the PRD for the retention policy (default: mirror snapshot retention — 30 days — once the prune script lands).

## Row shape (v1)

The seven required fields, per the governance plan section 6 and the JSON schema:

| Field | Type | Notes |
|---|---|---|
| `ts` | ISO-8601 UTC | The moment `publish.sh` appended the row. Not the moment of the source commit. |
| `skill` | enum (skill name) | One of the seven known skill directory names. New skills are added to the enum in the same commit that publishes them. |
| `task` | `^GSL-\d+$` | The Jira Task key whose commit is being published. |
| `commit` | full 40-char SHA | The git SHA that landed the development-copy change under `skill/<name>/`. |
| `lesson` | string | Root-cause lesson (free text). Empty is allowed but discouraged. |
| `status` | enum | One of `draft`, `reviewed`, `published`. `publish.sh` writes `published` at the end of a successful publish; drafts / reviewed rows may be appended by hand for future audit. |
| `intent_id` | string | The `server_intents.intent_id` value from the `POST /actions/skills/publish` call that produced this row. `null` allowed when the row was written from the CLI without going through the web endpoint. Used by the production test-guard (T10) to correlate a filesystem mutation with a legitimate publish. |

## Validation

Run `bash tools/skills/validate-changelog.sh` locally — exits 0 on a valid file, non-zero on any invalid row (with a diagnostic naming the row number). The check is opt-in inside `tools/lab/smoke.sh` behind `GOSLEEP_SKILLS_GUARD=1` until stage 1 (`GSL-251`) reverse-syncs the drift and the guard becomes always-on.

## Backups (`backups/<name>-<utc-ts>/`)

`publish.sh` creates a `cp -a` copy of `~/.claude/skills/<name>/` under `docs/skills/backups/<name>-<utc-ts>/` before it rsyncs the development copy in. The backup lives in git so a "publish undo" is `rsync -a docs/skills/backups/<name>-<utc-ts>/ ~/.claude/skills/<name>/` under an owner TTY.

## Non-goals

- Cross-project skill lessons (gsd-*, plugins) do not appear here.
- The registry does not record read events or non-publish edits — only publishes.
- No auto-fixups. A corrupt row must be corrected by the owner (append a new row that supersedes it in a subsequent publish).
