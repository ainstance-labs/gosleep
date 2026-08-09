# GSL-254 (T10, rest) — production test-guard in `tools/lab/smoke.sh`

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Closes GSL-254 — this + T2 (`verify-local.sh`) together form the fourth layer of the four-layer defense (plan section 2, PRD R8.2). T2 catches unpublishable state pre-rsync; T10 catches an agent that mutated `~/.claude/skills/<name>/` without going through `publish.sh` at all.

## What landed

- New baseline capture block near the top of `tools/lab/smoke.sh` (right after `PASS=0; FAIL=0`), gated on `GOSLEEP_SKILLS_GUARD=1`:
  - Writes `find ~/.claude/skills -type f | sha256sum` (path + hash, sorted) to `$WORK/skills-guard-baseline.txt`.
  - Extracts intent_ids from `docs/skills/CHANGELOG.jsonl` published rows to `$WORK/skills-guard-intents-baseline.txt`.
- New comparison block at end (right before `RESULT: PASS=… FAIL=…`), same guard:
  - Recomputes the hash listing to `skills-guard-now.txt`.
  - Extracts `intent_id\tskill` pairs from the CHANGELOG's published rows to `skills-guard-intents-now.txt`.
  - Diffs baseline vs now → `CHANGED_SKILLS` (skill dirs whose files changed).
  - Python one-liner set-difference on intent_ids → `NEW_INTENTS_SKILLS` (skills whose new intent_id appeared during this run).
  - `UNCORRELATED = CHANGED_SKILLS - NEW_INTENTS_SKILLS`. If non-empty → FAIL with the list.
- Keys strictly on `intent_id` per plan risk 3 ("matching CHANGELOG row must key on intent_id, not any published row in this run") — an in-flight publish whose baseline was captured before it landed shows its intent_id in NOW but not in BASELINE, so it correlates cleanly.

## Live-proof (hermetic sandbox `.artifacts/impl-174/t10-live-proof/`)

**T10.1 — bypass (should FAIL):**
- Baseline captures `handoff/SKILL.md` = "prod baseline v3", empty CHANGELOG.
- Sneak-modify `handoff/SKILL.md` = "SNEAK" (no CHANGELOG row added).
- End: `CHANGED_SKILLS=[handoff]`, `NEW_INTENTS_SKILLS=[]`, `UNCORRELATED=[handoff]`.
- Guard correctly FAILs with the diagnostic.

**T10.2 — legitimate publish (should PASS):**
- Baseline: `handoff/SKILL.md` = "prod baseline v2", CHANGELOG carries one old intent_id `old-intent-A` (skill=delivery-workflow).
- Publish flow lands: `handoff/SKILL.md` = "publish landed v2" + new CHANGELOG row with `intent_id=new-intent-B, skill=handoff`.
- End: `CHANGED_SKILLS=[handoff]`, `NEW_INTENTS_SKILLS=[handoff]`, `UNCORRELATED=[]`.
- Guard correctly PASSes (`every changed skill has a matching NEW CHANGELOG row`).

Both cases live-proven end-to-end. Real `~/.claude/skills/` untouched — HOME override in the sandbox.

## Design notes

- **Opt-in tonight.** `GOSLEEP_SKILLS_GUARD=1` gates the whole thing. Without stage 1 (GSL-251) reverse-sync, an ambient `~/.claude/skills/` edit by the owner between smoke runs would spuriously trip the guard. Once O1 lands + the CHANGELOG carries the full history, the flag flips always-on.
- **Python for set-difference.** Bash `comm` on lines with mixed shape (baseline: `<intent>`, now: `<intent>\t<skill>`) is footgun-y — python's `set` + explicit split is unambiguous. Falls back to `NEW_INTENTS_SKILLS=""` if `python3` is absent (unlikely; already required by validate-changelog.sh).
- **Every change treated equally.** Added files, removed files, and hash-different files all count as "changed" — an agent deleting `~/.claude/skills/foo/references/bar.md` is as much a bypass as an agent editing `SKILL.md`.
- **Same skill guardrails as elsewhere.** Baseline uses `find $HOME/.claude/skills`; if the dir is absent (fresh machine), baseline is empty and the guard is a no-op — no spurious failures.

## Gates

- `bash -n tools/lab/smoke.sh` → clean.
- Live-proof harness under `.artifacts/impl-174/t10-live-proof/` returns 0 on positive, non-zero on negative.

## Follow-ups

- Once stage 1 (GSL-251) lands, flip the `GOSLEEP_SKILLS_GUARD=1` opt-in to always-on (remove the outer `[[ "${GOSLEEP_SKILLS_GUARD:-0}" == "1" ]]` conditional) so the guard runs on every smoke.
- Optional v1.1: track `intent_id` provenance across a `restart` — currently the baseline is per-smoke-invocation; a longer-lived baseline (per-boot) would catch bypass edits made between smoke runs. Not needed tonight.
