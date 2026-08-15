# GSL-254 (partial, T2) — verify-local.sh

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

## What landed

- `tools/skills/verify-local.sh <skill-name>` — pre-publish sanity check invoked by `publish.sh` (T3) before rsync.
- Four checks:
  1. Skill dir exists under `skill/<name>/`.
  2. `SKILL.md` present + non-empty.
  3. Every file under `references/` (optional) is readable.
  4. Git working tree clean under `skill/<name>/` (scoped — lab dirt outside the skill dir does not trip it; skippable via `SKIP_GIT_CHECK=1` when a caller has already asserted cleanliness).
- Refuses `--all`, `*/*`, `..`, empty, and `--…` flag-shaped arguments with exit code 2.

## Live-proof (this worker ran it)

| Case | Command | Expected | Got |
|---|---|---|---|
| No arg | `verify-local.sh` | rc=2 + usage | rc=2 usage printed |
| `--all` | `verify-local.sh --all` | rc=2 refused | rc=2 refused |
| Path traversal | `verify-local.sh ../../etc` | rc=2 refused | rc=2 refused |
| Missing skill | `verify-local.sh no-such-skill` | rc=1 diagnostic | rc=1 "skill dir does not exist" |
| Valid, skip git | `SKIP_GIT_CHECK=1 verify-local.sh handoff` | rc=0 | rc=0 (4 PASS) |
| Valid, with git | `verify-local.sh handoff` | rc=0 | rc=0 (git working tree clean under skill/handoff) |

## Design notes

- **Scoped git check.** `git status --porcelain skill/<name>` bounds cleanliness to the target dir. The lab is always dirty during a live orchestration session (heartbeats, site regeneration, digest files); a global cleanliness check would refuse every publish for reasons unrelated to the skill. This is safe: publish.sh will refuse a publish when the exact bytes going to production are not a committed SHA.
- **Conservative posture.** A false positive (reject) has a small cost (owner re-runs after fixing); a false negative would push broken content to `~/.claude/skills/` where every project immediately picks it up.
- **`references/` optional.** `writing-prds` and `remote-control` currently have no `references/` — treated as PASS, not FAIL.
- **`SKIP_GIT_CHECK=1` escape hatch.** publish.sh may chain immediately after a fresh commit made by a different task; the outer git commit already asserted cleanliness so re-running it inside verify-local is a race window.

## Follow-ups

- T3 (GSL-253) calls `verify-local.sh <name>` before rsync and refuses on non-zero.
- Optional v1.1: reference-link check — parse SKILL.md for markdown links to files under `references/` and assert each target file exists (catches half-committed cross-references).
