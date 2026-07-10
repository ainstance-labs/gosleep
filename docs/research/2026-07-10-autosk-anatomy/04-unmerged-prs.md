# AutoSK unmerged PRs — full read (GSL-62, GH #71)

**Sources:** `gh pr list/view/diff -R wierdbytes/autosk` (live, 2026-07-10) · clone `.research-cache/autosk` @ `fd4c22e` (v0.2.4) for v2 cross-checks
**Date:** 2026-07-10 · **Researcher:** res-anatomy

---

## 0. Headline: all 6 open PRs are orphans of the v1→v2 clean break

All six open PRs come from **one outside contributor — `Conte777` (Alexey)** — submitted in a single burst **2026-06-01/02**. Three weeks later (v0.2.0, 2026-06-24) the author shipped the **v2 clean-break rewrite** (CHANGELOG.md:33-38: doltlite DB → plain files, Go daemon → Bun `autoskd`, JSON workflows → TS code extensions). Every PR targets v1-only paths that no longer exist at HEAD: `internal/daemon/poller|executor`, `internal/workflow`, `internal/store/doltlite`, `internal/migrations/*.sql`, `extension/runtime` (verified: `internal/pathcanon`, `internal/workflow` absent from the clone; PR #6 shows `mergeable=CONFLICTING state=DIRTY`; #1-#5 `UNKNOWN` — GitHub gave up recomputing). The author never reviewed, commented, merged, or closed any of them.

**This is the single loudest project-vector fact:** the only external contributor autosk ever attracted got 100% of his work silently invalidated by an unannounced full rewrite, and 12 days after v0.2.4 the repo is frozen (see `05-site-delta.md`). Bus-factor-1 in action, exactly as predicted in 01-autosk.md §8.8.

## 1. PR-by-PR

### #1 `fix: skip blocked work tasks` (+229/−19, 10 files, 2026-06-01)
- **What:** v1 daemon poller enqueued already-enrolled `work` tasks even with live blockers. Adds a SQL `NOT EXISTS` guard on `task_deps` — blockers with status not in `done/cancel` keep dependents out of the run queue (poller.go hunk adds the subquery to `Poller.Scan`); aligns `Ready`/`IsBlocked` semantics (`new/work/human` block; `done/cancel` release) with conformance + regression tests and doc updates.
- **Quality:** high — minimal precise fix, semantics table in body, tests at three layers (poller, store, conformance), docs updated.
- **v2 fate:** structurally absorbed — the v2 scan predicate already requires "not blocked" at claim time (01-autosk.md:56, `daemon/core/src/engine/engine.ts:391-453`).
- **gosleep:** the semantic itself matters — *terminal-only release* (done|cancel unblocks, human does NOT). gosleep's task-graph gating should copy this exact status partition.

### #2 `fix: preserve detail scroll under live overlay` (+83/−22, 3 files)
- **What:** `autosk lazy` TUI sticky-tail bug: with the live job-input overlay visible, a manual scroll-up in the Detail pane was misclassified as "at tail" on the next redraw and yanked back to bottom. Tracks overlay presence across passes and uses effective visible height for the at-tail test (`internal/lazy/tui/gui.go` + `sticky_tail_test.go` regression).
- **Quality:** good — narrow fix, both the new and prior regression cases covered.
- **v2 fate:** v1 TUI file survives in name (`internal/lazy/tui/` exists at HEAD) but the datasource was rewired to autoskd RPC in v2; patch no longer applies. Bug class likely still live (open issues #7/#8 are TUI bugs).
- **gosleep:** sticky-tail-with-overlay is a classic live-transcript-viewer trap; the rule to steal: *at-tail detection must use effective (overlay-reduced) viewport height, and anchoring decisions must be sticky across the frame the overlay appears*.

### #3 `fix: handle pi RPC prompt spawning in agent runtime` (+333/−24, 7 files)
- **What:** v1's `ctx.spawnPi` wrote the first message as **raw stdin text** to `pi --mode rpc` — wrong protocol; pi expects JSONL commands. Rewrites it into `extension/runtime/src/pi.ts` (new 227-line module, read in full from the diff): builds `pi --mode rpc [--model --thinking -e --skill]` argv, sends `{type:"prompt", id:"autosk-spawn-pi-prompt-1", ...}` as JSONL, then drives a mini state machine over pi's stdout events: prompt ack (`response` + matching id, `success`), `agent_end` → close stdin, `extension_ui_request` → auto-respond `{cancelled:true}` unless fire-and-forget (`notify/setStatus/setWidget/setTitle/set_editor_text`), JSONL parse errors → `protocolError`. Bounded 64KB `TailCapture` for stdout/stderr diagnostics; exhaustive exit-code/error matrix on `close` (start failure / prompt rejected / exit-before-ack / exit-before-agent_end / non-zero exit / protocol error), stderr tail appended to every error.
- **Quality:** the best of the six — production-grade child-process protocol handling; honest body even lists his own failing local test runs.
- **v2 fate:** superseded — v2's `@autosk/pi-agent` reimplements pi RPC driving from scratch and richer (see `02-pi-agent.md`). Notably v2's driver handles the same event families (prompt ack, agent_end, extension UI auto-cancel).
- **gosleep:** this file is a compact catalog of **everything that can go wrong when driving a JSONL-RPC agent child**: ack-the-first-prompt, distinguish exit-before-ack vs exit-before-end, auto-answer interactive UI requests so headless runs never hang, bounded output tails for diagnostics. Directly reusable checklist for gosleep's worker harness.

### #4 `fix: dedupe case-insensitive worktree aliases` (+616/−40, 6 files)
- **What:** on case-insensitive filesystems (macOS) the same project addressed with different casing produced duplicate loaded projects and orphaned worktrees. Adds `internal/pathcanon` (realpath + real directory-entry casing + `SameDir`), canonicalises daemon project resolution, migrates autosk-managed legacy worktrees via `git worktree move`, prunes stale registrations, keeps safety checks against touching external worktrees; tests incl. concurrent-migration serialization.
- **Quality:** high — thoughtful edge-case matrix (aliases, legacy migration, concurrency, external-worktree safety).
- **v2 fate:** idea independently absorbed: v2 canonicalises via `realpath` in `daemon/core/src/project/resolve.ts:14,43-46`.
- **gosleep:** any multi-project daemon keyed by path MUST canonicalise (realpath + casing) before using paths as identity — otherwise "one daemon per host serves any number of projects" silently forks state.

### #5 `feat: workflow package install, global registry & managed revisions` (+11,966/−230, 60 files, 12 commits)
- **What:** the big one — workflows as versioned npm packages: `autosk workflow install <pkg>` reading `package.json autosk.workflows`; a **global workflow registry** (XDG dir, canonical definition hashes) with `add/list/show/remove/enable/disable/sync/adopt/install/update`; `autosk workflow sync` materialises enabled globals into a project (dry-run → structured JSON preview); **managed revisions** — built-in workflow updates reconcile by canonical hash on `autosk init`, old referenced revisions preserved under reserved `@rev-<hash>` names so in-flight tasks never break; TUI markers `[global]/[stale]/[rev:X]` + `s`-to-sync; two SQL migrations; 6 new test files.
- **Quality:** ambitious and internally coherent, but 12k added lines from an outside contributor in one PR against a solo-owned repo was never going to merge — a scope/process misread as much as anything.
- **v2 fate:** *direction vindicated, implementation discarded.* v2 ships the same concept natively: extensions (workflows+agents) as npm packages under `~/.autosk/packages/`, GUI registry browser/installer, `daemon/core/src/extensions/{discovery,install,update,bootstrap}.ts`. The contributor correctly anticipated the product direction 3 weeks before v2 — with hash-pinned **managed revisions**, which v2 does NOT have (v2 loads whatever the extension file says at load time).
- **gosleep:** the one idea here v2 dropped and gosleep should keep: **revision-pinning of workflow/process definitions so in-flight work never sees its process mutate under it** (pin by content hash at enroll time; migrate only at boundaries).

### #6 `feat: honour cancel & render full signal dates` (+207/−1, 5 files)
- **What:** (a) v1 executor race: operator cancels a task while its agent still runs → on agent exit the executor would apply the agent's signalled transition anyway, resurrecting a cancelled task. Fix: after agent exit, re-read the task; if `status == cancel`, discard any transition except `human` and mark the run done gracefully (executor.go step "7.5" hunk). (b) TUI: signal timestamps spanning multiple days render full `YYYY-MM-DD HH:MM:SS` instead of ambiguous `HH:MM:SS` (`internal/lazy/tui/render.go`). Unit tests for both.
- **Quality:** good — two small, well-argued behaviors; the `cancel-except-human` carve-out shows real understanding of the state machine.
- **v2 fate:** v2 resolves the same race differently — while a session is live the **engine owns `status/step/workflow`** and the file watcher's reconciliation rejects external edits to them (01-autosk.md:82), i.e. v2 *prevents* mid-run cancel instead of honouring it. The contributor's semantics (human wins over cancel; cancel wins over any other transition) are arguably more operator-friendly.
- **gosleep:** define the **cancel-vs-in-flight-result precedence rule explicitly**: operator cancel must beat an agent's terminal transition, but a park-to-human should survive even a cancel (it carries information). Also: multi-day timestamp ambiguity in dashboards — render full dates the moment a view spans >1 day.

## 2. What the PR set says about the project & contributor

1. **Contributor quality is high** (protocol state machines, conformance tests, concurrency tests, honest failure reporting) — these are not drive-by patches; Alexey clearly ran autosk in anger for days and hit real operational races (blocked-task dispatch, cancel race, scroll UX, path aliasing).
2. **The bugs he found are a map of orchestration failure modes**: dispatch-while-blocked, operator-cancel vs agent-result race, live-tail UX under overlays, path-identity aliasing, process-definition versioning. Every one has a direct gosleep analogue.
3. **Zero maintainer engagement** (no review, comment, close) + clean-break rewrite = the project does not absorb outside momentum. For gosleep: mine autosk's code, expect nothing from its community process.
4. **Vector:** the author's own v2 built package-installable extensions and realpath canonicalisation — converging with #5/#4's ideas independently — while dropping #5's managed-revisions safety and choosing "engine owns status during run" over #6's cancel-honouring. The rewrite was architectural, not a rejection of these behaviors.

## 3. Ideas worth importing into gosleep (ranked)

1. **#3's JSONL child-driver error matrix** (ack-first-prompt, exit-before-ack vs exit-before-end, auto-cancel UI requests, bounded stderr tails) — HIGH: checklist for our `claude -p` worker harness.
2. **#6's cancel precedence rule** (cancel > agent transition, except `human` survives) — HIGH: gosleep must pick and document this semantics; autosk v2's "reject external edits during run" is the alternative.
3. **#1's terminal-only blocker release** (`done|cancel` release, `human` still blocks) — MED: exact status partition for task-graph gating.
4. **#5's managed revisions** (content-hash-pinned process definitions for in-flight work) — MED: v2 dropped it; gosleep's workflow files deserve it.
5. **#4's path canonicalisation as identity** — MED: trivial to adopt on day one, painful to retrofit.
6. **#2's overlay-aware sticky tail** — LOW: note for any future live dashboard.

## COVERAGE

**Covered:** all 6 open PRs — metadata, full bodies, changed-file lists; full diff hunks read for #1 (poller SQL), #3 (entire new pi.ts), #6 (executor 7.5 step); v2 cross-checks in the clone (blocked predicate, realpath resolve.ts, extensions discovery/install, absence of pathcanon/workflow dirs); merge-state via GitHub; v1→v2 timeline from CHANGELOG + git log.
**Not covered:** full line-by-line read of #4 and #5 diffs (616 / 11,966 additions — assessed via bodies + file lists + targeted v2 comparisons; #5's internals are dead code against v2); closed/merged PR history (task scoped to unmerged); the contributor's fork state.
**Confidence:** high on what/why/fate of each PR; medium on quality judgment of #4/#5 internals (not fully read).
