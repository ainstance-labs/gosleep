# Backlog triage — shift 79 (2026-08-16)

**Author.** triage-79 worker.
**Owner directive (2026-08-16).** Current program = refine the harness itself + the web interface. The **entire plugin program is DEFERRED** (do not schedule it). Main @ 53bab60, no open PRs.
**Data valid as of.** 2026-08-16, JQL sweep against `ainstance-labs.atlassian.net` project `GSL`.

## Headline numbers

| Bucket | Count |
|---|---|
| Total open (before this triage) | **53** |
| EXECUTE (in scope this program) | 33 |
| DEFERRED (mobile/tailscale/soak/legacy Preact-SSG/plugin-track skill edits) | 20 |
| Plugin-migration issues found in backlog | **0 as titled** — see key clarification below |
| Newly filed this triage (panel UX polish) | +3 (GSL-370 epic, GSL-371, GSL-372) |

**Key clarification (team-lead ruling, 2026-08-16).** GSL-182..188 **are** skill-content edits (roll trigger, workflow gate, spawn mechanics, git-stash ban, model policy, telemetry) — not plugin-migration tickets by title. However, R's roll directive of 2026-08-16 **named these keys explicitly** in the deferral list because, under the plugin model, skill edits become versioned plugin releases and global skills are owner-edited only; the skill-edit stream is therefore entangled with the deferred plugin/release track. **All open keys in the GSL-182..188 range are DEFERRED for that reason.** A JQL sweep for `summary ~ "plugin" OR summary ~ "marketplace"` returned zero open issues titled as plugin work; the plugin migration research artifact (`docs/reports/plugin-migration-research-2026-08-15/`, handoff #61-62) never crystallized into a titled Jira epic. Nothing else in the backlog carries the plugin heading.

## New work filed by this triage (panel UX polish)

- **Epic:** [GSL-370](https://ainstance-labs.atlassian.net/browse/GSL-370) — `[Web] Panel UX polish` — GH mirror [#353](https://github.com/ainstance-labs/gosleep/issues/353).
- **Task:** [GSL-371](https://ainstance-labs.atlassian.net/browse/GSL-371) — `[Web] Answer dialog: render clickable variant options` — GH [#354](https://github.com/ainstance-labs/gosleep/issues/354).
- **Task:** [GSL-372](https://ainstance-labs.atlassian.net/browse/GSL-372) — `[Web] Defer dialog: add short duration presets` — GH [#355](https://github.com/ainstance-labs/gosleep/issues/355).

Reuse-check: no existing open epic fits. GSL-266 covers only the Publish button flow; GSL-177 targets the deprecated Preact-SSG site (per CLAUDE.md); no other web-UX epic is open. A dedicated small epic keeps the polish in a single branch/PR.

## Observer-mode Phase C

Observer Phase B (GSL-361, epic) and its runtime-control follow-ups (GSL-347/350/365) are **Done**. Two non-blocking Phase-B follow-ups remain open — GSL-359 (pidtree/heuristic swap) and GSL-360 (sessions-collector tick 7-8 s under 500 + backlog).

The mission asked to check whether Phase C (task submission from web) exists. **It does not**, and I did **not** file anything for it — the mission asked me not to. The mission also pointed at `docs/prd/10-phase16-*.md`; that path does **not** exist. The observer PRD that Phase B implemented is `docs/prd/09-phase15-observer-mode-runtime-control.md` (referenced by GSL-361). A setup worker should read the Phase-C requirements from the same file series (or the follow-on `10-phase16-*.md` yet to be authored) and scope the epic there.

## Full inventory

Rows sorted by key. `Type` = E(pic) / T(ask). `Verdict` values: **EX** = execute, **DEF** = deferred. Verdicts of note carry a reason.

| Key | Type | Status | Summary (short) | Verdict | Reason |
|---|---|---|---|---|---|
| GSL-102 | E | In Review | Phase 6 — Mobile (RC + hook→ntfy + answer-path + break-glass) | DEF | Mobile umbrella; RC/ntfy/telegram/tailscale all frozen. |
| GSL-105 | T | To Do | hook→ntfy: fleet/lab push | DEF | Mission explicit. |
| GSL-106 | T | To Do | Telegram answer-path → queue.jsonl | DEF | Mission explicit. |
| GSL-107 | T | In Review | Tailscale + Blink/mosh break-glass runbook | DEF | Tailscale frozen by owner. |
| GSL-164 | T | To Do | docs/lab/README.md drifted (contract doc) | EX | Docs-only; small; safe even on frozen surface. |
| GSL-165 | T | To Do | Library reproducibility count 5 vs glob 6 | DEF | Preact-SSG surface; deprecated per CLAUDE.md. |
| GSL-166 | T | To Do | Library file column all `index.html` | DEF | Preact-SSG surface. |
| GSL-167 | T | To Do | `.grid` two columns at 391-416 | DEF | Preact-SSG surface. |
| GSL-168 | T | To Do | No `html lang`; no `th scope` on 13 tables | DEF | Preact-SSG surface. |
| GSL-174 | E | In Progress | Skills management system | EX | Current branch. Foundational for owner-in-the-loop skill edits. |
| GSL-177 | E | In Review | Web version freshness/connectivity/quality (Preact-SSG) | DEF | Targets deprecated legacy site; superseded by apps/web. |
| GSL-180 | E | To Do | Autonomy that learns and doesn't decide too much | EX | Harness process — matches owner directive. |
| GSL-181 | E | To Do | Acceptance verifies product; documents age officially | EX | Harness process. |
| GSL-182 | T | To Do | Skill: roll trigger | DEF | Explicitly named in R's 2026-08-16 roll directive (skill edits fold into the deferred plugin/release model). |
| GSL-183 | T | To Do | Skill: workflow gate | DEF | Same as GSL-182. |
| GSL-184 | T | To Do | Skill: agent spawn mechanics (TeamCreate absent) | DEF | Same as GSL-182. |
| GSL-185 | T | To Do | Skill: git-stash ban in shared tree | DEF | Same as GSL-182. |
| GSL-187 | T | To Do | Skill: model policy | DEF | Same as GSL-182. |
| GSL-188 | T | To Do | Skill: remove telemetry contradiction | DEF | Same as GSL-182. |
| GSL-227 | T | To Do | Validate `--rule` against manifest | EX | Harness. |
| GSL-228 | T | To Do | Risk tiers 0/1/2 with hard floor | EX | Harness safety. |
| GSL-229 | T | To Do | Question shape normalisation | EX | Harness. |
| GSL-230 | T | To Do | Question parking requires wake date | EX | Harness. |
| GSL-231 | T | To Do | Permissions inventory + draft `permissions.allow` | EX | Harness — read-only inventory. |
| GSL-232 | T | To Do | Verify unproven hooks StopFailure/TeammateIdle | EX | Harness. |
| GSL-233 | T | To Do | Self-health debts → FYI queue rows | EX | Harness. |
| GSL-234 | T | To Do | Integrity gate: no commit/history/mirror → no Done | EX | Delivery discipline. |
| GSL-235 | T | To Do | GH mirror is part of verifier-skeptic contract | EX | Skill contract. |
| GSL-236 | T | To Do | `armed-check` as phase acceptance criterion | EX | Harness. |
| GSL-237 | T | To Do | Reports carry "data valid as of" header | EX | Docs discipline. |
| GSL-238 | T | To Do | PRD delta part of every epic closure | EX | Docs discipline. |
| GSL-239 | T | To Do | Update acceptance-runs standard | EX | Docs. |
| GSL-240 | T | To Do | Create lessons-learned/ + adr/ folders | EX | Docs. |
| GSL-241 | T | To Do | Remove duplicate `docs/report`, `docs/dev-history` | EX | Docs cleanup. |
| GSL-242 | T | To Do | Split main skill into core + references | EX | Skill optimisation. |
| GSL-243 | E | In Review | System-audit 2026-07-24 publication + tails | EX | Publishes the audit that seeded these tasks. |
| GSL-256 | T | To Do | Abstract question-queue helper to contract | EX | Skill portability. |
| GSL-257 | T | To Do | Acceptance on a live skill lesson | EX | Closes GSL-174. |
| GSL-266 | T | To Do | First write button: POST /actions/skills/publish | EX | Blocked by GSL-288 (TouchID gate). |
| GSL-271 | T | To Do | Final switch: SQLite = source of truth | DEF | Mission explicit (soak-gated). |
| GSL-288 | T | To Do | CRITICAL: TouchID .app bundle never invoked | EX | Security-model gap; must ship before GSL-266. |
| GSL-340 | E | To Do | Expense-tracker table (run 02 E2E fixture) | EX | Web infra test fixture. |
| GSL-341 | T | To Do | Setup Vite React TS project | EX | Under GSL-340. |
| GSL-342 | T | To Do | Expense data model + seed | EX | Under GSL-340. |
| GSL-343 | T | To Do | Table sort + filter | EX | Under GSL-340. |
| GSL-344 | T | To Do | Pagination | EX | Under GSL-340. |
| GSL-345 | T | To Do | Grouping panel widget | EX | Under GSL-340. |
| GSL-346 | T | To Do | Neutral CSS styling | EX | Under GSL-340. |
| GSL-359 | T | To Do | Observer follow-up R2-1: pidtree/heuristic swap | EX | Non-blocking optimisation. |
| GSL-360 | T | To Do | Observer follow-up R2-2: sessions-collector tick 7-8 s | EX | Non-blocking optimisation. |
| GSL-367 | T | To Do | Lighter shim stdin peek — drop python3 spawn | EX | Hook fast-path optimisation. |
| GSL-368 | T | To Do | Investigate 9.4 s release-cutover fast-exit outlier | EX | Watch item; escalate on repro. |
| GSL-369 | T | In Progress | Sync shared tree to main; commit shift-78 ledger | EX | In flight by another worker (do not re-schedule). |
| GSL-370 | E | To Do | **NEW** Panel UX polish | EX | Filed this triage. |
| GSL-371 | T | To Do | **NEW** Answer dialog clickable options | EX | Filed this triage. |
| GSL-372 | T | To Do | **NEW** Defer dialog short presets | EX | Filed this triage. |

Missing key: GSL-186. Not open (either Done or never filed); no action required.

## Proposed execution order — waves of epics

The unit of scheduling is the **epic** (one branch, one PR per delivery-workflow convention). Standalone tasks are grouped into a synthetic epic-shaped batch where useful, and I flag when they can ride a shared branch. Waves are ordered by (a) unblocking dependencies, (b) directive priority (harness + web), (c) blast radius.

### Wave 1 — Critical security + blocker unlock (start immediately, in parallel)

| Item | Rationale |
|---|---|
| **GSL-288** — TouchID .app never invoked (CRITICAL) | Blocks GSL-266 (first write button). Standalone task, but ship it as its own PR: it edits `apps/core/src/spawn/*` and needs a dedicated verification. Maps to directive item **harness** (security floor). |
| **GSL-369** — Shared-tree sync to main (in flight) | Already In Progress by another worker; leave it alone but note the dependency so no other wave stacks conflicting changes on the same file set. |

### Wave 2 — Panel UX polish + observer follow-ups (owner-visible refinement)

| Item | Rationale |
|---|---|
| **GSL-370** — Panel UX polish (epic; GSL-371 + GSL-372) | Direct hit on directive item **panel-UX**. One branch, one PR. |
| **GSL-359** + **GSL-360** — Observer R2 follow-ups (bundle as `[Web][Core] Observer-mode R2 cleanups`) | Non-blocking optimisations against Phase B; low blast, small diff, share a branch since both touch `apps/core/src/observed/*`. Maps to **follow-ups**. |
| **GSL-367** + **GSL-368** — Hook shim fast-path + release-cutover watch (bundle as `[Tooling][Hook] Shim fast-exit cleanups`) | Same shared surface (`tools/hooks/shim.sh`, `tool-observed-feed.sh`), same fast-exit budget. Ship as one branch. Maps to **follow-ups** + **harness**. |

### Wave 3 — Skills-governance tail + first web write button

| Item | Rationale |
|---|---|
| **GSL-174 tail** — remaining non-content items only: **GSL-235** (verifier-skeptic contract requires GH mirror), **GSL-242** (split main skill into core + references), **GSL-256** (abstract question-queue helper to a contract), **GSL-257** (acceptance on a live skill lesson). The six named content edits (GSL-182..188) are DEFERRED per R's ruling; do NOT schedule them. `GSL-257` is the epic-closing acceptance and depends on all four items above. |
| **GSL-266** — First write button (Skills Publish) | Depends on GSL-288 (Wave 1). Ships on its own branch after GSL-288 lands. Maps to **harness/web-write path**. |

**Note on the deferred content edits.** GSL-182..188 remain valuable — the roll trigger, workflow gate, spawn mechanics, git-stash ban, model policy, and telemetry lessons are real and unresolved. They land under whatever release/plugin mechanism replaces global-copy authoring, not as freehand skill commits during this program. Keep them open in Jira as pending inputs to the future plugin/release track; revisit once R lifts the deferral.

### Wave 4 — Delivery discipline + docs hygiene (batch under GSL-243)

| Item | Rationale |
|---|---|
| **GSL-243** — System-audit publication + tails; roll it as the umbrella for GSL-227..242 (16 tasks) | Almost every task shares `tools/lab/` + docs surface. Schedule 3-5 tasks per branch, grouped by touched files. Roughly: (a) queue-emitter fixes (227, 229, 230, 233), (b) risk floor + parking + permissions (228, 231), (c) hooks (232), (d) integrity gate + verifier contract (234, 235), (e) armed-check (236), (f) docs hygiene (237, 238, 239, 240, 241), (g) skill split (242). |
| **GSL-180** — Autonomy that learns and doesn't decide too much | Owner-mandate + tier-2 automatic-decision guardrails. Depends on GSL-231 (permissions inventory) — sequence after. |
| **GSL-181** — Acceptance verifies product; documents age officially | Parallel with GSL-243 tail; touches `tools/lab/` acceptance gates. |

### Wave 5 — Observer Phase C scoping (setup worker required)

| Item | Rationale |
|---|---|
| **NEW EPIC (not yet filed)** — Observer mode Phase C: task submission from web | The mission explicitly asked NOT to file this. A setup worker must read `docs/prd/09-phase15-*.md` (and any newer phase-16 PRD once authored), scope the epic, then file it. Do NOT schedule work under this heading until the epic exists. |

### Wave 6 — E2E test fixture

| Item | Rationale |
|---|---|
| **GSL-340** — Expense tracker table (E2E fixture, epic + 6 tasks GSL-341..346) | Test infrastructure; low priority relative to product work. Fire when other waves cool. |

## DEFERRED items — do not schedule

- **GSL-102** (Phase 6 Mobile umbrella) — RC/ntfy/telegram/tailscale program frozen. Includes:
  - **GSL-105** (hook→ntfy) — mission explicit.
  - **GSL-106** (Telegram answer-path) — mission explicit.
  - **GSL-107** (Tailscale/mosh runbook) — tailscale frozen by owner.
- **GSL-271** — Final SQLite switch — soak-gated, mission explicit.
- **GSL-182, 183, 184, 185, 187, 188** — skill-content edits explicitly named in R's 2026-08-16 roll directive. Under the plugin model these fold into versioned plugin releases and are owner-edited only, so they are entangled with the deferred plugin/release track. Keep open in Jira; revisit once R lifts the deferral.
- **GSL-165, GSL-166, GSL-167, GSL-168** — verifier findings against the deprecated Preact-SSG site. Keep open but don't schedule; if the frozen HTML surface stays deprecated (per CLAUDE.md), close as `won't-fix` when confirmed with owner. **GSL-164** is docs-only and safe to include in a docs-hygiene batch.
- **GSL-177** — legacy-web-version quality epic; superseded by apps/web. Same treatment as above.
- **All plugin-program issues by title** — none found in the open backlog (see key clarification above).

## Dependencies and ambiguity

- **GSL-288 blocks GSL-266.** Do not schedule GSL-266 until GSL-288 lands and the physical-gesture gate is armed.
- **GSL-180 depends on GSL-231.** Permissions inventory is a read-only prereq for the tier-2 floor.
- **GSL-231 is read-only** — it does **not** flip permissions. The seat-change decision remains an owner call.
- **GSL-369 is in flight.** Any wave that touches tracked files under `docs/` or `.claude/` should wait for GSL-369 to land to avoid conflicts.
- **GSL-164..168 verdict is soft.** They are legacy-Preact findings. If a shift touches `docs/lab/site/*.html` for any reason, sweep them along; otherwise leave. GSL-164 is doc-only (`docs/lab/README.md`) and can ride a docs-hygiene batch cheaply.
- **Observer Phase C epic not filed.** The mission's referenced PRD path `docs/prd/10-phase16-*.md` does not exist. Setup worker must locate/author the PRD (the observer PRD family lives in `docs/prd/09-phase15-*.md` and further-numbered files) before scoping the epic.
- **Model policy for workers.** Per owner (2026-08-10): Opus by default, Sonnet minimum; Haiku forbidden. Every worker spawn under these waves must set `model:` explicitly and reconcile against the transcript.

## Top-3 recommended first waves

1. **Wave 1** — GSL-288 (critical security unlock) in parallel with the already-in-flight GSL-369.
2. **Wave 2** — GSL-370 (panel UX polish) + observer follow-ups bundle + hook-shim cleanups bundle. Three PRs, all owner-visible refinement.
3. **Wave 3** — finish the GSL-174 governance tail (GSL-235, 242, 256, 257 — the six content edits GSL-182..188 are deferred per R's ruling) on the current branch; then ship GSL-266 as the first web write button once GSL-288 clears.

## Files created by this triage

- `docs/reports/backlog-triage-2026-08-16/plan.md` — this file.

## Jira / GitHub changes made by this triage

- Filed GSL-370, GSL-371, GSL-372 (assigned to owner, To Do).
- Filed GH #353, #354, #355 with labels `epic` / `task`.
- Cross-linked Jira → GH via `commentBody`; GH bodies carry the Jira keys and cross-refs.
