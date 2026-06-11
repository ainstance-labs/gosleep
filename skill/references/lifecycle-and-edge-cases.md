# Agent lifecycle protocol + edge-case catalog

SKILL.md gives the model; this is the operational detail and the failure modes that actually bite. Every
entry was observed in, or verified against, a real multi-hour orchestration run.

## Spawn mechanics (per surface)

Tool names depend on the harness; these are the Claude Code shapes.

- **Agent Teams (live, tmux panes):** `TeamCreate` once, then spawn each worker with the Agent tool using
  `team_name` + a unique `name`. The worker opens in a tmux split pane. Coordinate via `SendMessage`;
  workers emit idle notifications at turn boundaries. Use a type with SendMessage (general-purpose).
- **Background subagent (headless):** spawn with the Agent/Task tool `run_in_background` (or a workflow
  task). It runs to completion and returns its final report as output; you can resume a completed one via
  its `agentId`. Kill with `TaskStop(task_id)`.

### Background-only mode (no Agent Teams / no tmux)
You lose live panes, nudging, and kill-pane. The loop becomes: spawn ONE bounded cycle → wait for its
return (or `TaskStop`) → read ONLY its returned report → chain the next. In this mode the live-monitoring
edge cases (E1, E2, E7, E8, E12) largely do not apply — a background task either returns or you stop it.
Everything else (handoffs, idempotent creates, git safety, the state file, recovery) still applies.

## Lifecycle: spawn → monitor → terminate → chain

### Monitor — liveness signals, ranked (highest confidence first)
1. A `SendMessage` report → the worker reached a boundary.
2. A `/workflows` task in a terminal state (completed/stopped/failed) → a background worker exited.
3. `tmux list-panes -F '#{pane_id} #{pane_dead}'` → pane process running vs exited.
4. Git movement → proves *progress*, NEVER proves *stopped*. Last resort, and lagging (a worker can read/
   plan/build 15+ min with zero git change).

Before concluding "stuck", corroborate with non-git evidence: `tmux capture-pane -p | tail`, build/log
mtime (`ls -lt`), a step the worker pre-flagged as long via a `PROGRESS` heartbeat. Probe read-only, off
the worker's tree (`gh ...`, `git fetch` + `git log origin/main..origin/<branch>`, `git ls-remote`, or
`git -C <path>`). Never read the worker's JSONL transcript.

### Terminate — per surface
- **Prefer self-quiescence:** a worker briefed to finish → handoff → report → go idle needs no kill; its
  COMPLETE report is your signal. Originating shutdown is a legacy path.
- **Graceful:** send `{type:'shutdown_request', reason}`. The worker REPLIES `{type:'shutdown_response',
  request_id, approve:true}` at its next turn boundary and exits (it may reject with `approve:false`).
- **Forced:** Agent Teams pane → `tmux kill-pane -t <pane_id>`; background → `TaskStop(task_id)`. Only when
  unresponsive AND safe-to-kill (below).

### Confirm termination — per surface — BEFORE chaining
- Pane: a `teammate_terminated` event naming THAT worker, and the pane is gone on re-list. Do NOT identify
  a worker by a raw `%N` pane id across spawn boundaries (tmux recycles ids) — re-list and match by NAME
  immediately before any kill-pane.
- Background: `TaskStop` returns success and/or the `/workflows` task shows terminal status.
- A `SendMessage` arriving AFTER a kill is a **late in-flight message, not liveness**.

### Safe-to-kill gate (define once, use everywhere)
`git status --porcelain` is **empty**, OR shows ONLY known build/output patterns (`dist/`, `.next/`,
`__pycache__/`, `*.log`, `coverage/`). Untracked SOURCE or modified tracked files = **NOT safe** → use the
hung-worker escalation (nudge to commit/revert → human), never a silent kill. Do NOT use
`--untracked-files=no` as the gate — it hides unsaved new source.

### Chain
Next cycle reads the handoff the prior worker wrote (validated against live git — see template Step 0). If
no handoff exists (worker died first), reconstruct the resume point from committed git state + the plan/
review docs and brief the new worker with it.

## The compact report contract

Workers send `CYCLE_ID / HANDOFF_FILE / CYCLE_STATUS / DONE_THIS_CYCLE / NEXT / BLOCKED_ON_HUMAN /
TELEMETRY` (≤ ~12 lines, no logs/diffs). The same block is the first section of the handoff
(`## ORCHESTRATOR REPORT`) so it survives a dropped message. Tally `TELEMETRY` into the state file.

## Edge-case catalog (cause → correct handling)

**E1 — Duplicate-work race (double-merge).** You nudge an idle worker AND spawn a "replacement"; the
original was still working → two workers do the same merge/closeout.
→ Never spawn a replacement until the prior worker is CONFIRMED terminated (per surface). Nudging is safe;
spawning a duplicate is not. "Idle, no report" = "maybe in flight", not "stopped".

**E2 — Premature kill of a productive worker.** You kill after one idle + a few minutes; its detailed
report and real progress arrive right after.
→ Be patient. Idle ≠ stuck. Use the liveness ranking + the two patience clocks (no git ~10–15 min AND no
report ~45–60 min). A clean tree alone does NOT mean stuck — it may be planning/reading/awaiting its own workflow.

**E3 — Crossed / superseding late messages.** Your message and the worker's reply pass in flight; or a
killed worker emits a final message after death; or a late message carries a NEWER handoff / flipped
CYCLE_STATUS / different NEXT than the one you already chained from.
→ Before any destructive action, re-check live state (git/gh/panes). Match messages by `CYCLE_ID`. Late
*additive* facts (already-created issues/tasks) → feed to the replacement to REUSE. Late *superseding*
facts → if the successor already spawned, re-check live git + newest handoff and correct the successor via
SendMessage BEFORE it acts on a stale baton. Quarantine a message whose worker is terminated and whose
facts are already in git.

**E4 — Branch collision (same working tree).** Two editing workers; git checks out one branch per tree;
concurrent edits corrupt the index/tree.
→ One editing cycle per tree. Sequence editing work. A read-only review may run concurrently but pin it to
an immutable ref (`gh pr diff <n>`, or a throwaway `git worktree add ../review-<sha> <sha>`) — a live
edited tree yields a self-inconsistent snapshot (file A at one commit, file B at another).

**E5 — Worktree isolation is not free.** `isolation:'worktree'` gives a separate tree, but it lacks
`node_modules` and gitignored `.env.local`/secrets, so builds and DB-gated tests fail there.
→ For Node/CI-gated repos, prefer sequencing; or budget for the worker to set up the worktree env (install
+ copy env) — expensive.

**E6 — Worker can't communicate.** A worker type without SendMessage (read-only research agent) finished but you got nothing.
→ Use SendMessage-capable types for anything that reports. For researchers: instruct `Bash`-write to a project-local gitignored `.artifacts/<name>.md` (never `/tmp`), then Read it.

**E7 — Unresponsive / hung worker (deadlock risk).** Idles, no report after a nudge across the window, no
new progress — AND may hold uncommitted work or reject shutdown.
→ Follow the escape hatch (SKILL.md flowchart): if safe-to-kill → kill per surface → fresh cycle rebuilds
from git. If dirty → ONE directive nudge ("commit-or-cleanly-revert WIP and approve shutdown within N
min") → still stuck → `BLOCKED_ON_HUMAN` (AskUserQuestion: discard-WIP-and-kill vs keep-waiting). Never
block the pipeline on one worker forever.

**E8 — Worker stalls at a boundary.** Committed all tasks but didn't open the PR / write a handoff / report.
→ ONE gentle nudge to finalize-or-handoff. A nudge, not a kill — no race risk as long as you don't also spawn a duplicate.

**E9 — Orphaned workflow.** A worker launched a background Workflow then died; the workflow's result reports to the dead worker (lost).
→ Be aware; re-run the audit in the replacement, or launch important audits from the orchestrator level so the result returns to you.

**E10 — Handoff numbering drift / truncation.** The `NN-` prefix is a project convention, not enforced;
files get skipped/collide; a worker dying mid-write leaves a truncated baton.
→ Derive next number deterministically (max NN, +1). Write atomically (temp → rename). Validate a handoff
against live git before trusting it; live git wins; the newest is not auto-trustworthy if its author died.

**E11 — Telemetry blindness.** The spawn tool doesn't return per-worker tokens/duration to the orchestrator.
→ Require a `TELEMETRY:` line per report; tally into the state file. Exact tokens are auto-surfaced only for Workflows (completion notification).

**E12 — tmux placement.** Agent Teams always uses split PANES (`teammateMode`), never windows; background subagents don't appear in tmux at all.
→ Don't `break-pane` into windows unless the human wants that. Default: panes in one window.

**E13 — Cross-pollination.** One stream's output (e.g. a review's findings) is exactly what an in-flight cycle needs.
→ Feed it via SendMessage, SCOPED: "fold THESE into your epic; leave the rest for a separate cycle" — so the worker doesn't balloon scope or collide with another branch.

**E14 — Decision forks.** Roadmap/epic boundary, or blocked on credentials / a denylist action / a product call / budget.
→ Pause and ask the human (AskUserQuestion). Otherwise keep advancing under granted authority.

**E15 — Non-idempotent creates (silent duplication).** A worker creates the epic + tasks + mirrored issues
+ branch, then dies before reporting; the replacement re-creates the whole epic.
→ Workers must find-or-create (template hard rule): search before creating ANY epic/task/issue/branch and
REUSE a match; use stable natural keys so a retry converges. The orchestrator feeds any late report's
created-IDs to the replacement.

**E16 — Merge-gate staleness.** Checks were green on an OLD head; two epics merge close together; after
merging A, in-flight B carries a stale base.
→ Before merging confirm `gh pr view <n> --json mergeStateStatus` is `CLEAN` (not BEHIND/BLOCKED) and
checks are green on the CURRENT head, or use require-up-to-date auto-merge. Merging A → tell B to
`git fetch` + rebase onto new main and re-run gates. Default sequencing avoids concurrent merges.

## What the orchestrator must NOT do

Reading handoff bodies, source, or worker transcripts to "understand" is the fastest way to blow your own
context and end the chain. Relay paths + compact reports, keep state in `ORCHESTRATION-STATE.md`, probe
read-only/off-tree. The ONE read exception: a dead worker that left a handoff but no clean report — read
ONLY its top `## ORCHESTRATOR REPORT` block (range read), recover CYCLE_STATUS/NEXT or the blocker,
summarize, discard.
