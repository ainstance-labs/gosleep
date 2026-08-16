# PRD — Phase 14: Observer mode, part A (machine-wide passive observability)

> **Status:** Draft — 2026-08-16 (per-phase file; first of the observer-mode program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347)
> **Source of truth for the vision:** owner briefing 2026-08-16 (verbatim-distilled in the epic description).
> **Ground-truth references:** `docs/runbooks/gosleep-core.md` section 8 (question-loop pilot — env-at-session-start guard), `CLAUDE.md` monorepo section (Bun+Hono core at `127.0.0.1:7331`, Fleet indexes host sessions transcript-based, guarded PreToolUse shims), decision log `d-2026-08-08-001` (widening interception only by explicit owner command).
> **Sibling phases (this program):** `09-phase15-observer-mode-runtime-control.md` (Phase B — runtime Take/Release control), `10-phase16-observer-mode-task-submission.md` (Phase C — task submission from the web, requirements-level only).
> **Sibling program (adjacent):** `03-phase9-plugin-orphan-rescue.md` … `07-phase13-plugin-e2e-shakedown.md` — the plugin migration is orthogonal to observer mode; observer mode reads whatever hook shims and skills are installed, whether they arrive by loose file, plugin, or nothing at all.
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).

---

## Positioning: the panel becomes a machine-wide mirror, not a gosleep-only mirror

Today the gosleep control plane is a mirror of what the gosleep repo does. The Fleet screen indexes Claude sessions transcript-based, the Timeline replays events emitted by the two shims wired in this project's `.claude/settings.json`, and the question loop only sees sessions that were spawned with `GOSLEEP_WEB_QUESTIONS=1` (runbook § 8). Every part of that mirror depends on the owner starting `claude` inside this project.

The owner-approved vision (2026-08-16) inverts that assumption. The owner works on **any project** — this repo, another repo, a scratch checkout — with the normal harness (orchestrator + workers in visible tmux panes). The panel runs **in parallel**, on the same machine, as a **passive observer** that shows every ongoing session, which tmux pane each worker occupies, and what task each worker is on. Passive means read-only: the observed projects do not install anything, no hook fires in an observed project, no signal leaves the host. When the owner glances at the panel from a second monitor or a phone (via Remote Control, Phase 6), the panel already knows what is happening machine-wide.

Phase 14 delivers exactly that shift for the observation half of the program. Phases 15 and 16 build on top of it: Phase 15 replaces the env-flag opt-in with a per-session runtime Take-control toggle (activation happens **in** the panel, not at session launch); Phase 16 layers task submission from the panel into a controlled session's tmux pane. Both later phases are inert on any session the owner never activates — the observer-first default is preserved forever.

**Zero-influence guarantee is non-negotiable.** Every collector this phase introduces reads existing artefacts on the host (tmux server socket, Claude Code transcript directory, filesystem timestamps under observed cwds, `ps`/`lsof` output). No collector edits a file in an observed project, spawns a process into it, adds a hook to its `.claude/settings.json`, or reaches into the observed session's stdin/stdout. A user who runs `claude` in another repo cannot tell from inside the session that gosleep is watching — the only externally-visible signal is the panel updating on the owner's screen.

---

## Goal

The owner opens `http://127.0.0.1:7331/observed` and sees, updated within one SSE round-trip, a machine-wide map of every live Claude session and every tmux pane on the host, correlated to a per-project group. Each session card names the project (derived from `cwd`), the tmux pane it occupies (session/window/pane ids + pane title), the worker role if attributable, the current task (from an observable signal, not a hook the observed project installed), and a short recent-activity strip built from passive signals only. A separate observed-activity timeline aggregates cross-project events (session start, session idle, transcript growth, git head movement under observed cwds) in one stream, with a filter chip per observed project. Fleet keeps existing behaviour for gosleep sessions; observed sessions from other projects appear with a distinguishing badge and no "answer / decide" affordances (those are Phase 15's job). The panel section listing "what is being observed" enumerates every collector, its data source, its polling cadence, and a **write-attempt count** that must stay at zero — the empirical proof of the zero-influence guarantee.

---

## Scope

| In | Out (and why) |
|---|---|
| **Tmux map collector** (`apps/core/src/observed/tmux.ts`, polled every 2 s). Reads the local tmux server via `tmux list-sessions -F '#{session_id}\t#{session_name}\t…'`, `list-windows`, `list-panes -F` — including `pane_pid`, `pane_current_command`, `pane_current_path`, `pane_title`, `pane_start_command`. Persists into a new `tmux_panes` table (columns: `session_id`, `window_id`, `pane_id`, `pane_pid`, `pane_current_path`, `pane_current_command`, `pane_title`, `first_seen`, `last_seen`). Correlates `pane_pid` to Claude Code processes by walking the pid tree (parent pid, grand-parent) and cross-checking against `claude_sessions.pid` from the existing Fleet indexer. | Reading pane contents (`tmux capture-pane`) — that is a screen read of another human's/agent's work; excluded on principle even though the observed-project directory is trivially accessible. Owner may lift this in a later phase for gosleep-owned panes only, never for arbitrary observed panes. |
| **Claude session enumerator (machine-wide)** (`apps/core/src/observed/sessions.ts`, polled every 5 s). Walks `~/.claude/projects/*/` and each project's `history/` and `sessions/`, reads the latest transcript entry timestamp per session (already the source Fleet uses), and infers `project_slug` from the project-directory name. Emits one row per live session into the extended `claude_sessions` table (adds columns `project_slug`, `cwd`, `observed_only` boolean). | Reading transcript **bodies** for non-gosleep projects (only header/last-line/`ts` is read to compute liveness); pushing observed-session data anywhere off-host. |
| **Project attribution** — derive `project_slug` from `cwd` (basename of the first git-toplevel encountered walking up from the pane's `pane_current_path`, with `~` collapsed). A `projects` projection table (`project_slug`, `cwd_root`, `git_toplevel`, `first_seen`, `session_count`, `last_activity`) is rebuilt on each poll from the joined `tmux_panes` ∪ `claude_sessions` view. Legend colours per project are assigned deterministically by a hash of `project_slug`. | Any recursive scan of an observed project's file tree, any read of an observed project's `.git/HEAD` beyond `git -C <toplevel> rev-parse --short HEAD` (single-shot cheap read used only when a `HEAD` file mtime change fires). |
| **Observed-activity timeline** — a new `observed_events` table (`ts`, `project_slug`, `kind`, `payload_json`) fed by four passive-signal producers: (1) tmux pane appeared / disappeared, (2) Claude session appeared / went idle (> 60 s no transcript growth), (3) transcript-growth ticks (coalesced to one event per session per 30 s window), (4) git HEAD movement under observed cwds (fs-watcher on `<git-toplevel>/.git/HEAD` mtime). A read endpoint `GET /observed/events?since=<seq>&limit=…&project=<slug>` and a matching SSE topic `observed.events` deliver them to the panel. | Content-diff events (what changed in a commit / what a worker typed) — deferred to a possible v1.1 that would require an explicit owner opt-in per observed project. |
| **Fleet enrichment** — the existing `/fleet` endpoint gains three columns per row: `project_slug`, `tmux_pane_ref` (`session:window.pane`), and `observed_only` (true = we saw the session but no gosleep hook is installed, so answers/decisions cannot be routed). The Fleet screen renders `observed_only` cards with a muted "observer only — no control" badge and disables answer/decide affordances on them. | Any behaviour change on non-observed rows; Fleet cards for gosleep sessions continue to work exactly as they do post-GSL-297. |
| **Observed screen (`apps/web/src/screens/Observed.tsx`)** — new route child `{path:"observed"}`, NAV entry. Layout: left-rail project list (deterministic-colour swatch + session count + last activity), main area with a session-card grid (one card per Claude session, `observed_only` cards muted), right-rail collector inventory ("what is being observed" — per-collector rows: name, data source, polling cadence, event count today, **write attempts (should always be 0)**). Empty state: "No Claude sessions detected on this host. tmux panes without a Claude process are also listed for context." | Deep dashboards per observed project (git graph, per-file activity heatmaps); those belong to future opt-in per-project integrations, not to a passive observer. |
| **Write-attempt sentinel** — every collector runs inside a wrapper that asserts, before dispatch, that the collector's declared side-effect set is `∅`. A stray `open(..., "w")` / `writeFile` / `spawn` outside the whitelist trips an in-process invariant that (a) increments the panel's write-attempt counter for that collector, (b) logs a `WRITE_ATTEMPT_DENIED` structured line to `data/logs/core.err.log`, and (c) shuts the offending collector down without restart until the process restarts. Panel surfaces the counter red if non-zero. | Kernel-level sandboxing (seatbelt / bpf) — out of scope for v1; the runtime invariant is enough given the small collector surface. |
| **Timeline separation** — the existing gosleep timeline (`GET /timeline`, `timeline.*` SSE) stays exactly as it is; the observed-events stream is a distinct endpoint / SSE topic. The UI can overlay them side-by-side in a future v1.1 view; v1 keeps them in separate screens to make the empty state on the observed screen readable and to avoid mislabelling. | Merging streams behind a single endpoint (would collide with the write-envelope conventions and force a schema change on the gosleep timeline). |

---

## Success criteria

- **F14-S1 (tmux map).** With a live tmux server carrying at least four panes across two sessions (one gosleep pane, one non-gosleep pane, one shell-only pane, one Claude-in-another-project pane), `GET /observed/tmux` returns four rows with correct `pane_pid`, `pane_current_path`, and `pane_title`, and the fs-watcher-triggered "pane appeared" / "pane disappeared" events land in `observed_events` within 3 s of a `tmux new-window` and `tmux kill-pane`. The `tmux_panes` table survives a core restart (idempotent re-fold on boot).
- **F14-S2 (machine-wide Claude enumeration).** With two live Claude sessions — one started inside this repo (`~/.claude/projects/-Users-…-gosleep/`), one started inside a scratch repo (`/tmp/other-repo`, transcript directory materialised as `~/.claude/projects/-tmp-other-repo/`) — `GET /fleet` returns two rows, both with populated `project_slug` and `tmux_pane_ref`, and the non-gosleep row's `observed_only=true`. The Fleet card for the observed-only row renders with the muted badge, and no answer/decide button is visible or reachable via keyboard focus.
- **F14-S3 (cross-project timeline).** Starting a `claude` session in the scratch repo, running one prompt, letting it go idle for 60 s, then making a `git commit` in the scratch repo produces exactly four `observed_events` rows keyed on `project_slug="scratch"`: `session_appeared`, `transcript_activity` (coalesced), `session_idle`, `git_head_moved`. `GET /observed/events?project=scratch` returns them in-order with monotonic `seq`; the SSE `observed.events` topic delivers each within 1 s of the underlying signal.
- **F14-S4 (zero-influence, live).** During F14-S1..F14-S3, the write-attempt counter for every collector stays at 0; no file under `/tmp/other-repo` or `~/.claude/projects/-tmp-other-repo/` is modified by gosleep (verified by `find … -newer <pre-run-marker>`); the scratch-repo Claude session's transcript header is unchanged (byte-identical) between pre-run and post-run reads; no process was spawned into the scratch-repo cwd by gosleep-core.
- **F14-S5 (Observed screen).** `http://127.0.0.1:7331/observed` renders with left-rail projects grouped correctly (gosleep, scratch, "no-git" bucket for shell-only panes), the session grid shows one card per live Claude session with project chip + tmux pane ref + observed-only badge where applicable, and the right-rail collector inventory lists four collectors with cadence, event-count-today, and write-attempts=0. SSE invalidation flips a card between "active" / "idle" without a manual refresh.
- **F14-S6 (verification-report proof).** The live multi-project scenario used for F14-S2..F14-S5 is recorded end-to-end (per-step screenshots + narrative) as an HTML report EN+RU under `docs/reports/verifications/GSL-347/runs/01/index.html`, per memory `web-verification-html-runs.md` (2026-08-10) and `verification-report-runs-format.md` (2026-07-23). The report explicitly cites the write-attempt counters and the byte-identical transcript-header proof as its evidence for the zero-influence claim.

---

## Requirements

- **R14.1 — Zero-influence is a structural invariant, not a discipline.** No collector writes anywhere except the gosleep data dir; the runtime wrapper enforces it and surfaces a counter to the panel. If the counter goes non-zero at any point in an owner-observed run, the phase does not pass acceptance and the offending collector is disabled until fixed. Acceptance: F14-S4, F14-S6.
- **R14.2 — Machine-wide, not repo-wide.** Every collector enumerates the whole host: all tmux sessions from the same server, every Claude session under `~/.claude/projects/`, every pane whether or not it lives inside this repo. Enumeration MUST NOT filter by `cwd` prefix; the "project" grouping is a projection, not a scope. Acceptance: F14-S1, F14-S2.
- **R14.3 — Observed sessions are visible but powerless.** Fleet rows with `observed_only=true` render but never expose answer / decide / defer / take-control affordances; the panel refuses to open answer dialogs on them. This is what makes Phase 14 safe to ship before Phase 15 lands: the panel can already see everything, and cannot yet act on it. Acceptance: F14-S2, F14-S5.
- **R14.4 — Every observed event is traceable to a passive host signal.** The `observed_events` row schema requires a `source` enum: `tmux-list`, `transcript-mtime`, `fs-watcher`, `pidtree`. Rows with `source='hook'` are refused by the writer — hooks belong to the gosleep timeline. Acceptance: F14-S3, F14-S6.
- **R14.5 — Collector cadence is bounded and declared.** Each collector declares a maximum polling cadence in code (2 s tmux, 5 s Claude sessions, event-driven for git HEAD); the collector inventory read endpoint publishes it; the panel surfaces it. Any drift (a collector polling faster than declared) trips a WARN log line and is a bug. Acceptance: F14-S5.
- **R14.6 — Observed-only session data never leaves the host.** No collector calls the network (empirically verified in F14-S4 via a per-run `lsof -i` sample); no Jira / GitHub / ntfy egress carries an observed_only payload; the `/observed/events` and `/fleet` endpoints stay bound to `127.0.0.1` under the existing security envelope. Acceptance: F14-S4, F14-S6.

---

## Tasks (epic `[Docs][Web] Observer-mode PRD (phases A-C)`, [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347))

The PRD itself is delivered by two tasks — [GSL-348](https://ainstance-labs.atlassian.net/browse/GSL-348) (three phase files) and [GSL-349](https://ainstance-labs.atlassian.net/browse/GSL-349) (README + monolith pointers). Implementation tasks below will be filed under a **separate implementation epic** at execution time, not this documentation epic; they are named here so the PRD carries its own decomposition.

1. **Tmux map collector + schema** (`apps/core/src/observed/tmux.ts`, `packages/schema/tmux.ts`, migration adding `tmux_panes`).
2. **Machine-wide Claude session enumerator** — extend `apps/core/src/fleet/indexer.ts` to walk every project directory and populate `project_slug`, `cwd`, `observed_only`.
3. **Project projection + deterministic colouring** (`apps/core/src/observed/projects.ts`, `apps/web/src/lib/project-colour.ts`).
4. **Observed-events writer + endpoint + SSE topic** (`apps/core/src/observed/events.ts`, `apps/core/src/routes/observed.ts`, register on the SSE broadcaster).
5. **Fleet endpoint enrichment + Fleet screen respect of `observed_only`** (extend `apps/core/src/routes/read.ts`, gate answer/decide affordances in `apps/web/src/screens/Fleet.tsx`).
6. **Observed screen + route + NAV** (`apps/web/src/screens/Observed.tsx`, `apps/web/src/router.tsx`, `apps/web/src/components/AppShell.tsx`).
7. **Write-attempt sentinel wrapper** (`apps/core/src/observed/sentinel.ts`) + a `/observed/collectors` read endpoint exposing counters.
8. **Live multi-project verification run** — record per-step screenshots + narrative into `docs/reports/verifications/GSL-347/runs/01/index.html` (EN + RU) per memory `web-verification-html-runs.md`; explicitly cite F14-S4 evidence.

---

## Non-goals (explicit)

- Reading tmux pane contents (`capture-pane`) for any pane — even gosleep-owned; content capture is a separate opt-in feature, not part of a passive observer.
- Any hook installed into observed projects. If an observed project happens to have its own gosleep-style hook wiring, that is coincidence, not a Phase 14 mechanism.
- Egress of observed-only session data (Jira / GitHub / ntfy / anywhere off-host).
- Deep per-project dashboards, git graphs, per-file activity — belong to future opt-in per-project integrations.
- Taking control of an observed session. That is Phase 15 and requires an explicit runtime toggle owned by the core (`d-2026-08-08-001` — activation is the owner command).
- Submitting a task into an observed session. That is Phase 16 (and only into a session that Phase 15 has activated).
- Any behaviour change on gosleep-native sessions (Fleet cards for gosleep continue exactly as post-GSL-297).

---

## Dependencies

- **Phase 7 web control plane** (GSL-250, feature-complete after GSL-297) — provides the endpoint envelope, the SSE broadcaster, the `withTimeline` writer, and the Fleet indexer that Phase 14 extends.
- **Phase 8 skills-management envelope** (GSL-174) — no functional dependency, but Phase 14 inherits the same three-layer write envelope on the two write endpoints it adds (collectors themselves are read-only).
- **Plugin migration program** (GSL-337, phases 9-13) — orthogonal. Observer mode does not require plugins; the collectors read whatever hooks / skills / files exist. A future note in Phase 15 will flag the option to ship the runtime-toggle-aware shim via the `gosleep-orchestration` plugin so a fresh machine can be observed without hand-editing hooks.
- **Owner memory `web-verification-html-runs.md`** (2026-08-10) — every acceptance run in this program produces an HTML report EN+RU under `docs/reports/verifications/GSL-347/runs/NN/`.
- **Owner memory `terminology-skills-management-system.md`** (2026-08-07) — the phrase "observer mode" is the terminology-approved name; the panel calls this the "Observed" screen, not "Sessions" or "Everything" (both would collide with existing terms).

---

## Risks + open questions

- **Risk 1: pid-tree correlation is fragile on kernel process restarts / detach-and-reattach.** A `claude` process that reparents from tmux to `launchd` (or dies and is replaced by an auto-restarter) breaks the `pane_pid → claude_session` link. *Mitigation:* on lost link, fall back to `pane_current_path` + `pane_title` heuristic (Claude Code writes a recognisable title); flag as `attribution=heuristic` on the Fleet card. Question for the owner: is it OK to render the card as observed-only-without-attribution rather than dropping it entirely when correlation is lost?
- **Risk 2: `~/.claude/projects/*` naming is opaque per project.** The directory name is a URL-escaped cwd; two different project cwds that collapse to the same escaped name would collide. *Mitigation:* the enumerator reads the first line of the newest transcript to extract the actual `cwd` field Claude Code writes and uses that; the directory name is a fallback only. Question for the owner: does the panel show the escaped name or the resolved cwd as the tooltip on the project chip? (Recommended default: resolved cwd, escaped as fallback.)
- **Risk 3: Sensitive project names leak via the observed screen.** The owner might not want a client project's name visible on a passive-observer screen a screenshot ends up in. *Mitigation:* a per-project opt-out list in `data/observed/hidden-projects.json` (owner-owned, git-ignored); collectors continue to observe the project but the panel renders the row with a stable pseudonym (`project-b`, `project-c`) sourced from the file. Question for the owner: opt-out list is enough, or is a global "redact all non-gosleep project names by default" the safer default?
- **Risk 4: fs-watcher on `.git/HEAD` for many observed repos can exceed FD limits.** *Mitigation:* cap the watcher at the 32 most-recently-active projects and fall back to a 30 s poll of the tail. Question: is 32 the right cap for this owner's typical machine, or should the cap be a config knob?
- **Risk 5: The 60-second idle threshold is arbitrary.** *Mitigation:* declare it as a config knob (`observed.idle_threshold_s`), default 60. Question: is 60 s the right default, or is the owner more likely to want 120 s to avoid noise from short model turns?
- **Risk 6: Panel visibility of an observed project's task assignment.** If a Claude session in the observed project uses `AskUserQuestion` with a task hint, that lands in the observed project's own transcript — the panel would need to read the transcript body to surface it. Phase 14 stops at "session appeared / transcript growing", not at "current task". *Mitigation:* explicit non-goal. Question: does the owner want a v1.1 that reads observed transcripts' *last user message* (still passive, still local) to surface a task-line per card, or is that already too much for a "passive observer"?
- **Risk 7: The plugin program (GSL-337) may ship a `gosleep-observer` plugin later that installs a shim into observed projects, turning observation from passive into agent-aware.** That would be a completely different mode — the owner would explicitly enable it per project. This PRD is bounded to the passive read; the plugin path is a note only. See Phase 15 § dependencies for the reframing.

Morning-digest questions (with recommended defaults):

- **Q1.** Pane content capture on gosleep-owned panes (yes for gosleep panes, never for observed panes)? → **default:** deferred; if surfaced, always opt-in per session.
- **Q2.** Project name redaction: opt-out list vs global default-redact? → **default:** opt-out list.
- **Q3.** Idle threshold default? → **default:** 60 s.
- **Q4.** Task-line inference from observed transcripts (v1.1)? → **default:** no; the passive contract stops at "session appeared / transcript growing".
- **Q5.** Rendering an attribution-lost card (observed-only-without-attribution vs drop)? → **default:** render, with an explicit `attribution=heuristic` badge.

---

## Sources

- Owner briefing 2026-08-16 (verbatim-distilled in the [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347) epic description).
- `docs/runbooks/gosleep-core.md` — section 8 (question-loop pilot: env-at-session-start guard; widening rule per `d-2026-08-08-001`); section 1-2 (core lifecycle and endpoints that Phase 14 extends).
- `CLAUDE.md` — monorepo layout (`apps/core`, `apps/web`, `packages/schema`, `packages/sdk`) and the Fleet indexer path that Phase 14 hooks into.
- `docs/prd/01-phase7-interactive-control-plane.md` — Phase 7 PRD, R7.4 fleet view and the endpoint envelope reused here.
- `docs/prd/02-phase8-skills-management.md` — the write-envelope pattern (Bearer + Origin + Idempotency-Key + `serialize` + `withTimeline`) which Phase 14's *reads* pass through unchanged.
- `docs/prd/03-phase9-plugin-orphan-rescue.md` … `07-phase13-plugin-e2e-shakedown.md` — the plugin program; called out here only to note it is orthogonal.
- `docs/lab/decisions/log.jsonl` — `d-2026-08-08-001` (widening interception only by explicit owner command — the owner-gate framing this program builds on).
- Owner memory `web-verification-html-runs.md` (2026-08-10) and `verification-report-runs-format.md` (2026-07-23) — HTML-report EN+RU convention for acceptance runs.
- Owner memory `terminology-skills-management-system.md` (2026-08-07) — naming discipline for observer mode.

---

*End of Phase 14 PRD (Observer mode part A — passive observation).*
