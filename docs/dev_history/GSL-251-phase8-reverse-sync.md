# GSL-251 — [Skill][Process] Reverse-sync O1: local `skill/` copies caught up from authoritative global

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management` · **PR:** #307
**Owner sanction:** rule `d-2026-07-20` (global `~/.claude/skills/` is authoritative for
delivery skills). Task GSL-190 (tmux reverse-sync + `CLAUDE.md`/`skill/README.md`
reconciliation) folds into this commit set per plan
`docs/reports/skills-management-plan-2026-08-10/plan.md` §O1.

## What happened

One-off reverse-sync — direction **global → local only**. For every owned skill, `rsync
-a --delete "$HOME/.claude/skills/<name>/" "skill/<name>/"` was run once (this reads
from global, writes to `skill/<name>/`); the global tree was **not** touched (never
written to, never `install.sh`-ed, never overridden). After the seven runs, `diff -r
skill/<name>/ ~/.claude/skills/<name>/` prints nothing for every skill.

## Per-skill drift folded in

| Skill | Drift (local was behind global) | Result |
|-------|---------------------------------|--------|
| `orchestrating-delivery-agents/` | +21 / −12 lines. Two production lessons carried over — (a) the "ScheduleWakeup is NEVER the turn's last tool call" corollary and the shift-74 evidence that motivated it; (b) heartbeat-first / wake-up-second turn order in the pulse worked example and in the "Ending a turn" row of the pulse table. | Local now == global. |
| `delivery-workflow/` | +7 / −13 lines. Production copy tightened wording (already in the CLAUDE.md tree note as "the authoritative copy"). | Local now == global. |
| `handoff/` | +1 / −18 lines. Production copy carries the shift-closing skill-lessons checklist (GSL-189 root treatment for R5) and the "silence must be explicit" clause referenced from `CLAUDE.md`. | Local now == global. |
| `using-jira/` | +16 / −0 lines. Production carries the `ATLASSIAN_API_TOKEN` lesson that only existed globally. | Local now == global. |
| `writing-prds/` | 0 / 0 (already equal). | No-op; listed for completeness of the seven-skill catch-up. |
| `remote-control/` | 0 / 0 (already equal — added since the governance plan; no prior drift). | No-op; listed for completeness. |
| `tmux-agents-orchestration/` | **Absent from git entirely.** Global was the only copy (~14 KB, mtime 2026-07-13). Directory created and populated. | Local now == global. |

## Why global was authoritative

Owner order `d-2026-07-20` inverted authority for the delivery skills: production
copies at `~/.claude/skills/<name>/` are the source of truth, local `skill/` copies had
known problems. Reverse-sync direction has since been guarded (`./install.sh` — which
would push local → global — is BANNED from agent hands per `CLAUDE.md` Safety rules).
This task is the one-off owner-sanctioned catch-up that lets stages 2–3 of GSL-174
(publish flow) treat `skill/` as the working copy again.

## What was NOT touched

- No writes to `~/.claude/skills/` (any file mtime there is pre-task; `rsync` was
  read-only against that side).
- No `./install.sh` invocation (would have pushed local → global — the forbidden
  direction).
- No `git stash` / `git reset` / `--force` push (verbatim ban, incident
  `q-2026-08-08-001`).
- No orchestrator live files (`docs/lab/**`, `docs/handoff/**`) staged — commit staged
  only the paths this task wrote: `skill/**`, `CLAUDE.md`, `skill/README.md`,
  `docs/dev_history/GSL-251-phase8-reverse-sync.md`.

## Doc reconciliation folded in

- `skill/README.md` — "Owned skills" table now enumerates all seven (added
  `remote-control/` and `tmux-agents-orchestration/` rows).
- `CLAUDE.md` §"Skill source of truth" — tree updated from "all 5 owned skills" to
  "all 7 owned skills"; `remote-control/` and `tmux-agents-orchestration/` appear in
  the ASCII tree. The Safety-rules block (`d-2026-07-20` on
  `orchestrating-delivery-agents` staying globally authoritative) is unchanged — the
  reverse-sync is a one-off owner action, not a policy shift.

## Acceptance (per ticket)

1. `find skill -maxdepth 1 -type d` — 8 lines (parent `skill/` + 7 owned skill dirs). ✓
2. `diff -r ~/.claude/skills/<name>/ skill/<name>/` empty for every skill. ✓
3. `CLAUDE.md` and `skill/README.md` list all seven consistently. ✓
4. `install.sh` guard untouched (agents still forbidden from bulk sync). ✓
