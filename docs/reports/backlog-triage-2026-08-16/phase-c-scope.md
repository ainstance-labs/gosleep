# Observer Phase C — scoping note

**Author.** setup-phasec worker (shift 79).
**Date.** 2026-08-16.
**Purpose.** Corrects the triage plan's Wave 5 stub (which claimed no Phase-C PRD existed) and records the implementation-epic decomposition ready for a coding worker.

## PRD source of truth

- **`docs/prd/10-phase16-observer-mode-task-submission.md`** — the single PRD for Phase C. The plan.md line "the mission's referenced PRD path `docs/prd/10-phase16-*.md` does not exist" is **wrong** — the file is checked in, comprehensive, and explicitly requirements-only in v1 with a six-step implementation seed ready to decompose (PRD § Tasks).
- Related PRD context: `docs/prd/09-phase15-observer-mode-runtime-control.md` (Phase B — runtime Take/Release control, HARD dependency for R16.1 + R16.5), `docs/prd/08-phase14-observer-mode-observation.md` (Phase A — `tmux_panes` map and Fleet/Observed cards for the Submit button surface).
- Program epic covering all three PRDs: [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347) — Done.

The Phase C PRD is deliberately "design-heavier, no implementation tasks in v1" and points to a fresh implementation epic. This note delivers that epic.

## Filed artifacts

### Jira (project GSL, all To Do, all assigned to owner)

- **Epic** [GSL-378](https://ainstance-labs.atlassian.net/browse/GSL-378) — `[Web][Core] Observer Phase C — task submission from panel`. Linked to GSL-347 (Relates).
- Tasks (one commit each, epic-order):
  - [GSL-379](https://ainstance-labs.atlassian.net/browse/GSL-379) — `[Core][DB]` `task_submissions` table + Drizzle migration + `packages/schema` types.
  - [GSL-380](https://ainstance-labs.atlassian.net/browse/GSL-380) — `[Core]` Executor `apps/core/src/sessions/submit.ts` (literal-text `send-keys -l` + `Enter`).
  - [GSL-381](https://ainstance-labs.atlassian.net/browse/GSL-381) — `[Core][Route]` `POST /actions/sessions/:session_id/submit-task` (dry-run + confirm) + `GET /sessions/:session_id/submissions`.
  - [GSL-382](https://ainstance-labs.atlassian.net/browse/GSL-382) — `[Core][Event]` Timeline event kinds `task.submitted` / `task.submit.failed` + Timeline renderer.
  - [GSL-383](https://ainstance-labs.atlassian.net/browse/GSL-383) — `[Web]` Submit-task button + dialog with mandatory dry-run preview + submission-history drawer.
  - [GSL-384](https://ainstance-labs.atlassian.net/browse/GSL-384) — `[Docs][Report]` Live verification run at `docs/reports/verifications/GSL-347/runs/03/index.html` EN+RU (F16-S1..S7).

### GitHub mirror (ainstance-labs/gosleep)

- Epic issue [#369](https://github.com/ainstance-labs/gosleep/issues/369) (label `epic`).
- Tasks [#370](https://github.com/ainstance-labs/gosleep/issues/370) … [#375](https://github.com/ainstance-labs/gosleep/issues/375) (label `task`), one per Jira task, same order.
- Jira → GH cross-links posted as `commentBody` on every issue; GH bodies name the Jira keys and cross-link back.

## Sequencing

Tasks are decomposed so each is one commit, but they have real dependencies. Recommended implementation order for the coding worker:

1. **GSL-379** (schema) — foundational; must land before anything that reads or writes `task_submissions`.
2. **GSL-380** (executor) — pure function; can be developed against unit tests + a scratch tmux session without any HTTP surface.
3. **GSL-381** (endpoint) — wires GSL-380 into the three-layer envelope; extends `core-smoke.sh` with three refusal scenarios.
4. **GSL-382** (timeline events) — parallelisable with GSL-383, but its schema addition (event kinds) is a prerequisite for the panel to render badges correctly. Land before GSL-383.
5. **GSL-383** (UI) — the owner-facing surface; requires all of GSL-379..382 to be live. Live-proof screenshots feed GSL-384.
6. **GSL-384** (verification report) — the closer; blocks epic Done. Must record every refusal path (F16-S2..S6), not only the happy path (F16-S1).

Single branch `GSL-378-observer-phase-c`, single PR, one commit per task, regular-merge (never squash) — matches this repo's delivery-workflow conventions.

## Risks and dependencies

Called out here for the coding worker; every one of these is already captured in the PRD text and the task descriptions, but concentrated here for planning ergonomics.

- **HARD dep on Phase B state registry.** Phase C never submits into a session where `state != 'controlled'` or where `shim_registered = false`. The endpoint refuses with 409 and the button does not render. GSL-380 (executor) and GSL-381 (endpoint) both re-read state at dispatch; GSL-383 (UI) hides the button entirely (no disabled tooltip). Regression in Phase B's control registry would break this.
- **Three-layer write envelope must be reused as-is.** `requireBearer` + `requireOrigin` + `Idempotency-Key` + `serialize("session.submit", session_id)` + `withTimeline` — same shape as Phase 15's Take/Release endpoints. This is not just a convention: the F16-S4 acceptance ("428 preview-required") is provable only because the `Idempotency-Key` flows across the dry-run → confirm boundary.
- **Executor primitive is deliberately narrow.** `tmux send-keys -t <resolved> -l <body>` + `Enter`, argv arrays only, no `sh -c`, no hex escapes, no control sequences, sub-0x20 bytes rejected except Tab and Newline. Widening this primitive without an owner ask is a security-model change.
- **Pane target is looked up at dispatch.** Never from the request body. A stale pane triggers 409 `pane_gone`; the executor does not send to a wildcard, does not fall back, does not attempt a "closest match" recovery.
- **Live-proof is mandatory for the UI task.** Owner memory `web-verification-html-runs.md` (2026-08-10) — this is a user-facing surface and the epic cannot land without GSL-384's HTML report walking all seven success criteria per-step in EN + RU. GSL-383 must be developed with screenshots collected as-you-go to make GSL-384 tractable.
- **Body payload discipline.** 16 KB cap (R16.7); the full body lives in the timeline event payload (subject to the existing retention policy), the `task_submissions` row only stores hash + length. Do not add a "body" column to the history table.
- **No steering primitives.** No Ctrl-C, no `/reset`, no in-flight cancellation. These are the Remote Control (Phase 6) surface. Confusion between Phase C and Remote Control is Risk 6 in the PRD.
- **Workers stay visible.** Owner memory `workers-visible-in-tmux.md` (2026-08-10) — the receiving pane is always a visible tmux pane. This is a design requirement (R16.8), not just a testing preference; the executor never targets a backgrounded process.

## Open questions for the owner

The PRD § Risks + open questions block ends with a "Morning-digest questions (with recommended defaults)" list. **None of these need to be resolved before implementation starts** — every one has a defensible default the PRD names, and the tasks above encode those defaults verbatim. The coding worker should raise these to the owner only if implementation reveals a genuine conflict:

- Q1 (Prompt-boundary wait ceiling): 5 s default.
- Q2 (Auto-close-idle dialog): no default (per memory `no-silent-default-decisions.md`).
- Q3 (Secret-shape regex warning): yes, advisory-only, in the preview.
- Q4 (Body max): 16 KB.
- Q5 (Reject sub-0x20 bytes): yes.

Per the owner memory `no-silent-default-decisions.md` (2026-08-08), if the coding worker feels any of these defaults is wrong for a specific scenario encountered mid-build, escalate explicitly rather than silently overriding.

## Corrections to the triage plan (Wave 5 stub)

The triage plan's Wave 5 line "the mission's referenced PRD path `docs/prd/10-phase16-*.md` does not exist" is factually wrong — the file is checked in. This scoping note supersedes that line. Wave 5 is now unblocked: GSL-378 is the epic; GSL-379..384 are the tasks; #369 + #370..#375 mirror them on GitHub. The coding worker can pick GSL-378 up as soon as any other Wave 3 or Wave 4 work makes room in the branch pipeline.

## Files created by this note

- `docs/reports/backlog-triage-2026-08-16/phase-c-scope.md` — this file.

## Jira / GitHub changes made by this scoping worker

- Filed Jira epic GSL-378 (To Do, owner-assigned).
- Filed Jira tasks GSL-379..384 (To Do, owner-assigned).
- Linked GSL-378 → GSL-347 (Relates).
- Filed GH issue #369 (epic) and #370..#375 (tasks) under `ainstance-labs/gosleep` with labels `epic` / `task`.
- Posted Jira ↔ GH cross-links as `commentBody` on every issue and inside the GH bodies.
