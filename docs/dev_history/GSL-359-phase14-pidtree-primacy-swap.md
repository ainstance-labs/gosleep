# GSL-359 — Observer R2 follow-up 1: pidtree/heuristic primacy swap

**Date landed.** 2026-08-16.
**Branch.** `GSL-373-observer-r2-followups`.
**Epic.** GSL-373 — `[Core] Observer R2 follow-ups`.
**Worker.** impl-359 (shift 79).
**Verifier finding source.** GSL-350 verify-350 run 02 (round-2, non-blocking).

## Symptom

The pid-tree "primary" path (`apps/core/src/observed/pidtree.ts::resolvePaneForTranscript`) never
fires against real Claude Code sessions. `lsof -t <transcript.jsonl>` returned empty 200/200
times in the R2 verification pass because the Claude CLI opens the transcript, appends the
frame, and closes the handle per turn — there is no long-lived open fd for lsof to observe.
The cwd-prefix heuristic (`pane_current_path LIKE cwd_project_root || '%'`) carried the whole
observed fleet; every /fleet row landed with `attribution='heuristic'`. The eager `lsof` +
`ps -o ppid=` subprocess spawns inside the enumerator's hot path paid a per-session per-tick
cost for zero resolutions.

## Direction picked

**Option A** from the ticket: swap primary/fallback ordering. Concretely:

1. The sessions collector no longer calls `resolvePaneForTranscript` by default. The lsof +
   pidtree walk now requires an explicit opt-in via `GOSLEEP_OBSERVER_LSOF=1`. The path is
   preserved (functions still exported, benchmark hook still available) for controlled
   experiments and any future Claude CLI variant that keeps the transcript file handle open.
2. The /fleet SQL now puts the heuristic path first in both `COALESCE(...)` and the
   `attribution` `CASE`. The pidtree path is a strict fallback that only fires when the
   opt-in populated `agent_sessions.pid` AND the heuristic missed (e.g. the shell cd-ed out
   of the project root, leaving `pane_current_path` outside `cwd_project_root`).
3. Comments across the three touched files (`pidtree.ts`, `sessions.ts`, `routes/read.ts`)
   document the new ordering and the reason we retired the eager hot-path lsof.

## Files touched

- `apps/core/src/observed/pidtree.ts` — header docs updated to state the path is opt-in and
  why; side-effects section reworded.
- `apps/core/src/observed/sessions.ts` — header docs updated; the enumerator's per-transcript
  resolve block is gated on `process.env["GOSLEEP_OBSERVER_LSOF"] === "1"`.
- `apps/core/src/routes/read.ts` — CTE renamed (`heur` / `pid`), COALESCE flipped, CASE
  flipped, surrounding comments rewritten. Result-projection docstring updated.
- `apps/core/test/observed.sessions.test.ts` — one new test (`GSL-359: default enumeration
  leaves tmux_pane_pid null (lsof is opt-in via GOSLEEP_OBSERVER_LSOF)`) pins the contract:
  even when `panePids` is non-empty, absent the env, every snapshot's `tmux_pane_pid` is null.
  A future revert of the gate would fail loudly.

## Why not option B / C

- **Option B** (`pgrep -af '(claude|Claude Code)'` + argv session-id) inherits the same
  process-visibility problem lsof does (Claude launches under launchd on macOS; argv may not
  carry a stable session identifier) and adds a new brittle parser we would then own.
- **Option C** (10 s cached full-tree sweep) would still cost lsof across every transcript on
  every 10 s window — same cost, worse timing granularity, same zero-hit rate against the
  actual CLI write pattern. If we ever revive the pidtree path, the opt-in env is enough to
  measure Option C without a schema change.

## Verification

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core/test/observed.pidtree.test.ts apps/core/test/observed.sessions.test.ts`
  — 14 pass. All pre-existing pidtree/session tests still exercise the underlying functions
  (they call the helpers directly, not through the gated enumerator path).
- Live-leg: scratch core on port 7347 against a fresh scratch DB and a small fake
  `~/.claude/projects` tree; two `tmux_panes` rows seeded by hand — one whose
  `pane_current_path` sits under an observed session's `cwd_project_root`, one that matches
  nothing. `/fleet` returned that observed row with `attribution="heuristic"` and
  `tmux_pane_ref="live-leg:@0.%1"`; every other row (native-1 whose pane_current_path is
  above its cwd, the six cold rows with no matching pane) surfaced `attribution=null`. No
  row surfaced `attribution="pidtree"` because the opt-in stayed off. Evidence:
  `docs/dev_history/assets/GSL-359/fleet.json`,
  `docs/dev_history/assets/GSL-359/collectors.json`, and the runner
  `docs/dev_history/assets/GSL-359/run.sh` (rerunnable end-to-end).

## Rollback

Re-enable the eager path by setting `GOSLEEP_OBSERVER_LSOF=1` in the core launchd env; no
schema change is needed. Revert this commit to restore the earlier ordering wholesale.
