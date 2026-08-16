# GSL-348 — Observer-mode PRD: three phase files (Phase A observation / B runtime control / C task submission)

**Task:** GSL-348 — `[Docs][Web] Observer-mode PRD: three phase files (A observation, B runtime control, C task submission)`
**Epic:** GSL-347 — `[Docs][Web] Observer-mode PRD (phases A-C)`
**Branch:** `GSL-347-observer-mode-prd` (worktree at `.claude/worktrees/obs-prd/`)
**Date landed:** 2026-08-16

---

## Part 1 — Plain-language story

Owner briefing today (2026-08-16) approved the OBSERVER-MODE program in his own words: he works on ANY project the normal way (orchestrator + workers in visible tmux panes); the gosleep web panel runs IN PARALLEL as a passive observer showing everything happening (which sessions, which tmux panes belong to which workers, what tasks are being worked); it MUST NOT influence the process until he explicitly activates control; when activated (a runtime function in the UI, not a launch-time env flag), the panel takes over question/permission interception — while tmux panes remain open and visible. Later, task submission from the web. This task turns that vision into three per-phase PRD files.

**Numbering.** The plugin-migration program (GSL-338) ended at `07-phase13-…` on `origin/main`. This program continues the sequence:

- `08-phase14-observer-mode-observation.md` — Phase A. Passive machine-wide observability.
- `09-phase15-observer-mode-runtime-control.md` — Phase B. Runtime Take-control / Release-control per session.
- `10-phase16-observer-mode-task-submission.md` — Phase C. Task submission via a core-side `tmux send-keys -l` executor. Requirements-level only in v1 (design-heavier surface; ships after the owner has lived with Phase 15).

Every file follows the house style already set by `01-phase7-*`, `02-phase8-*`, and the plugin-program `03-phase9-*..07-phase13-*`: status header with ticket + source-of-truth pointers, Positioning, Goal, Scope table with In / Out and why, Success criteria (F<phase>-S<n>), Requirements (R<phase>.<n>), Tasks (list, no Jira creation from a PRD), Non-goals, Dependencies, Risks + open questions with morning-digest defaults, Sources.

**Ground truth kept honest.** The three files repeatedly cite `docs/runbooks/gosleep-core.md` § 8 and decision `d-2026-08-08-001` (widening interception only by owner command). The MIRROR + OPT-IN INTERCEPTOR framing is preserved everywhere — Phase 14's "observe everything" does not touch interception; Phase 15's "runtime Take-control" is the reframed owner-command surface, with the env-flag path kept forever as a legacy bootstrap and outage-fallback; Phase 16's submit path refuses to fire on any session not in `state='controlled'`. No PRD claims to change today's behaviour by default.

**Zero-influence guarantee for Phase A.** Made structural, not aspirational: R14.1 makes it a runtime invariant (write-attempt sentinel wraps every collector; the panel surfaces the counter; non-zero fails acceptance and shuts the collector down). R14.6 forbids any observed-only session data leaving the host. F14-S4 requires empirical proof (`find … -newer`, byte-identical transcript headers, `lsof -i` sample). F14-S6 requires the verification report to cite that evidence.

**Owner-gate reframing for Phase B.** R15.5 makes `docs/runbooks/gosleep-core.md` § 8 update a required deliverable: activation IS the owner command that `d-2026-08-08-001` requires; env-flag path is legacy bootstrap. Decision log stays as-written — PRD is the reframing surface.

**Design pressure for Phase C.** The submit path can type free text into another agent's stdin — highest blast radius surface in the program. R16.1..R16.5 stack the guardrails: `state='controlled'` required, `shim_registered=true` required, mandatory dry-run preview (endpoint returns 428 without a prior `dry_run=true` under the same idempotency key), core-side pane resolution (never trust the request body's target), release-mid-submit aborts. R16.7 bounds the executor to `tmux send-keys -l` + a single `Enter`. R16.8 keeps receiver panes visible per owner memory `workers-visible-in-tmux.md`.

**Cross-references to the plugin program.** Called out as *note only* in Phase 15 Dependencies: the runtime-toggle-aware shim is a natural candidate to later ship inside `gosleep-orchestration` plugin so a fresh machine can be brought under panel control without hand-editing `.claude/settings.json`. Neither program depends on the other.

**Skeptic pass (writing-prds step 6).** Mission brief forbids subagents/teammates; used the skill's documented fallback — refute checklist myself with fresh eyes:

- *"Does Phase A silently install anything in the observed project?"* — No. R14.1 makes it a structural invariant; the sentinel + F14-S4 empirical proof close the door.
- *"Does Phase B reduce the owner-gate strength versus `d-2026-08-08-001`?"* — No. The decision required an owner command; activation IS the owner command, now per-session with better audit. R15.5 spells out the reframing in-line.
- *"Does Phase C smuggle in a steering primitive?"* — No. R16.7 restricts the executor to literal text + Enter; R16.9 explicitly lists Ctrl-C, `/reset`, `/exit`, scroll-back-read, in-flight-cancel as v1 non-goals; the dialog banner names the boundary to Remote Control.
- *"Is 'observer-mode' the terminology the owner would accept?"* — Yes; not colliding with existing terms ("Fleet", "Timeline", "Sessions", "Skills"). Panel screen is called "Observed".
- *"Are the acceptance criteria empirically checkable, not just prose?"* — Every F<phase>-S<n> names a concrete signal, endpoint, or table state; F14-S6 / F15-S7 / F16-S8 pin the HTML-report EN+RU convention per owner memory `web-verification-html-runs.md`.

**What hurt.** Two friction points:

1. The plugin program that just landed on `origin/main` was authored in a `/tmp/gsl-337-phase-prd/` worktree; the memory rule `no-git-stash-in-shared-tree.md` reinforces that shared-tree git ops are dangerous. Per mission brief I placed the observer worktree at `.claude/worktrees/obs-prd/` (never `/tmp`, never the shared tree). Ran `git worktree add … -b GSL-347-observer-mode-prd origin/main`; the current session's branch `GSL-174-skills-management` (10 commits ahead of origin/main with unclean tree per initial `git status`) was left untouched — the worktree is on a fresh clean tree tracking `origin/main`.
2. Numbering discipline again — verified `origin/main` at `b4560d5` carries `03..07-phase13` already, so `08..10-phase14..16` slot in cleanly with no gap and no collision with any concurrent worker (the sibling worker `panel-obs` is on its own worktree serving live core; it does not touch `docs/prd/`).

**What is deliberately NOT here.**

- Implementation of the observer program. This task is docs-only; implementation epics are the next owner decision. Phase 16 in particular ships with no implementation tasks in v1 — requirements-level only until the owner is ready.
- Any `~/.claude/**` writes.
- No `Workflow` tool, no subagents/teammates, no `git stash / reset --hard / add -A` in a shared tree — hard rules from the mission brief held.
- No monolith prose edits beyond the tightly-scoped "Phases 8-16 per-phase files (index only)" section appended to `PRD-gosleep-evolution.md`. That row-list is the pointer surface the README convention promises but the plugin-program PRD workers never actually added; this task closes that gap for phases 8-16 in one shot.

---

## Part 2 — Short technical reference

### Files touched (this task)

```
docs/prd/08-phase14-observer-mode-observation.md          (new)
docs/prd/09-phase15-observer-mode-runtime-control.md      (new)
docs/prd/10-phase16-observer-mode-task-submission.md      (new)
```

### Jira

- Epic: **GSL-347** — `[Docs][Web] Observer-mode PRD (phases A-C)` (In Progress).
- This task: **GSL-348** — `[Docs][Web] Observer-mode PRD: three phase files (A observation, B runtime control, C task submission)` (In Progress → Done at commit).
- Sibling task: **GSL-349** — README + monolith pointers.

### Cross-links

- Ground truth: `docs/runbooks/gosleep-core.md` § 8, decision `d-2026-08-08-001`.
- House-style templates: `docs/prd/01-phase7-interactive-control-plane.md`, `docs/prd/02-phase8-skills-management.md`, plugin program `docs/prd/03-phase9-…` … `07-phase13-…`.
- Owner memories cited across the three files: `web-verification-html-runs.md`, `no-silent-default-decisions.md`, `no-ragged-context-to-owner.md`, `workers-visible-in-tmux.md`, `terminology-skills-management-system.md`, `no-git-stash-in-shared-tree.md`.

### Verification of the docs task

- `wc -l docs/prd/08-phase14-*.md docs/prd/09-phase15-*.md docs/prd/10-phase16-*.md` — sane sizes, comparable to peer PRDs.
- `grep -n "TODO\|TBD\|FIXME" docs/prd/{08,09,10}-*.md` — none.
- No `§` sign anywhere per owner memory `no-section-sign-in-text.md`.
- All three files pass the "English only" rule (only Russian text is in-line memory titles cited by name, which is the same pattern the plugin PRDs use).

---

*End of dev history for GSL-348.*
