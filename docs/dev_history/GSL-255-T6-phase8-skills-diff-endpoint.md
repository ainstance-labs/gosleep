# GSL-255 (T6 partial) — `GET /skills/:name/diff` + enriched `GET /skills`

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

The full GSL-255 also owns the Skills web screen (T7); this dev-history captures the T6 endpoint half.

## What landed

- New module `apps/core/src/skills/diff.ts` — filesystem hash + diff for skill directories.
  - `hashSkillTree(dir)` → sha256 over sorted files (`<rel>\x00<bytes>\x00`), sentinel `absent` for missing dirs, `sha256:e3b0…7852b855` for empty trees.
  - `runDiff(prod, local)` → `diff -u -r --new-file`, bounded to 200 KB with a truncation marker (per plan risk 4).
  - `computeSkillDiff(name)` → cached (per-name, 5-second TTL) full result: `{name, hasChanges, diffText, diffBytes, truncated, hashLocal, hashProd, localExists, prodExists, computedAt}`.
  - `quickHasChanges(name)` → cheap "has-changes" check that reuses the same cache but skips the `diff` spawn (used by the list-view enrichment on `GET /skills`).
  - `clearSkillDiffCache()` for tests.
- New endpoint `GET /skills/:name/diff` (Bearer-gated) — per-name `serialize()`, name-shape validation (`/^[a-z0-9][a-z0-9-]{0,63}$/`), 404 on unknown skill, 400 on bad name.
- Enriched `GET /skills` — union of DB rows + `KNOWN_SKILLS` (so production-only `tmux-agents-orchestration` still appears with a placeholder before O1). Each row gets `has_changes`, `local_exists`, `prod_exists`, `hash_local`, `hash_prod` computed from `quickHasChanges`.
- Schema (`packages/schema/src/index.ts`) — `SkillRow` extended with optional filesystem fields; new `SkillDiffResponse` z-object.
- SDK (`packages/sdk/src/index.ts`) — new `coreClient.skillDiff(name)` method mirroring `skills()`.

## Live-proof (scratch core on port 7332, sandbox HOME)

- Scratch DB migrated, sandbox prod `handoff/SKILL.md` = "prod baseline SKILL.md — different from repo".
- Core booted (`GOSLEEP_CORE_PORT=7332`, `GOSLEEP_BEARER_TOKEN=…`, `HOME=<sandbox>`).
- `GET /skills` → 7 skills, `handoff` row shows `has_changes=true`, two distinct hashes.
- `GET /skills/handoff/diff` → `hasChanges=true`, `diffBytes=10674`, `truncated=false`, diff text starts with `diff -u -r --new-file <sandbox>/…/handoff/SKILL.md /…/gosleep/skill/handoff/SKILL.md`.
- `GET /skills/no-such/diff` → HTTP 404.
- `GET /skills/Bad-NAME/diff` → HTTP 400 (invalid name shape).
- `GET /skills/handoff/diff` **without Bearer** → HTTP 401.
- Port 7332 released clean after `kill -9`.

## Design notes

- **Filesystem-derived status wins.** The DB `status` column ("clean" / "published") is a registry-only view (the last-published-audit); the row-level Skills-page indicator uses `has_changes` computed from `find + sha256sum` at read time. Two orthogonal facts: "has anyone ever published this?" (DB) vs "does the working copy match production right now?" (filesystem).
- **200 KB diff cap.** Plan risk 4 is honest — the drift for `orchestrating-delivery-agents` after 50 lines is well under 200 KB, so tonight's endpoint returns full diffs; a v1.1 ticket adds pagination when needed.
- **5-second cache + serialize.** A burst of clicks on the Skills screen (list + drawer) shares one filesystem walk; the per-name mutex prevents two overlapping `diff` spawns for the same skill.
- **Empty vs absent.** An empty tree hashes to a canonical known sentinel (`sha256:e3b0…7852b855`); an absent dir hashes to `absent`. These are distinct — a skill with no development copy (`tmux-agents-orchestration` today) reads `has_changes=true` with `hashLocal=absent`, which the UI can render as "no development copy — publish blocked" per plan risk 5.
- **`--new-file`.** Ensures the diff treats missing sides as empty. Otherwise `diff` would skip subdirs that live only on one side.

## Gates

- `bun x tsc -p apps/core --noEmit` → exit 0.
- `bun x tsc -p packages/schema --noEmit` → exit 0.
- `bun x tsc -p packages/sdk --noEmit` → exit 0.

## Follow-ups

- T7 (Skills web screen) consumes both endpoints via `useSkills()` + a new `useSkillDiff(name)` hook.
- T5 (POST /actions/skills/publish) does not depend on this — but the endpoint's SSE broadcast will invalidate the queries this endpoint's cache lives behind (the invalidation happens on the SSE client side; the server cache TTL is 5 s so it converges anyway).
