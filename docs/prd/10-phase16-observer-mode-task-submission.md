# PRD — Phase 16: Observer mode, part C (task submission from the web)

> **Status:** Draft — 2026-08-16 (per-phase file; third of the observer-mode program; REQUIREMENTS-LEVEL ONLY — design-heavier, no implementation tasks in v1)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347)
> **Source of truth for the vision:** owner briefing 2026-08-16 (verbatim: "later, task submission from the web").
> **Ground-truth references:** `docs/runbooks/gosleep-core.md` sections 8 + 8.5 (interception surface and Bearer discovery), owner memory `workers-visible-in-tmux.md` (2026-08-10 — workers must remain visible tmux panes, not backgrounded).
> **Sibling phases (this program):** `08-phase14-observer-mode-observation.md` (Phase A — observation), `09-phase15-observer-mode-runtime-control.md` (Phase B — runtime activation, required upstream).
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).

---

## Positioning: pose a task, do not steer

Phase 14 lets the panel see machine-wide. Phase 15 lets the owner grant per-session control to the panel at runtime. Phase 16 adds the missing verb: with a session under control, the owner can compose a task in the panel and post it into that session's tmux pane, and the session picks it up as if the owner had typed it directly. This is not "live steering" (that stays on the Remote Control Phase 6 surface, `remote-control` skill semantics); this is a well-defined write of a whole task into a receiving session's tmux stdin.

The design pressure is high, because writing free text into another agent's stdin is one of the most powerful side-effects the panel could take. The requirements below front-load the guardrails: only into sessions with `state='controlled'` (Phase 15 activation) AND with the runtime-toggle-aware shim registered; never into observed-only sessions; always with a dry-run preview the owner confirms; always through a whitelist of send targets bound to Fleet cards, never a free-form tmux target; every submission is a first-class timeline event with the full payload and the resolved target.

**Requirements-level only in v1.** This phase does not yet ship code. The three phases of the program land in order: 14 first (safe, read-only), 15 next (owner-gated activation), 16 last, and only after 14 and 15 are green in production and the owner has lived with them long enough to feel that a task-submission verb is worth the blast radius. The purpose of writing this PRD now is (a) to bound Phase 15's design so its state pill and control registry compose correctly with a future submit surface, and (b) to give the owner an English artifact to react to before implementation begins.

---

## Goal

The owner opens a Fleet or Observed card for a session where `state='controlled'` and `shim_registered=true`, clicks **Submit task**, types a task in a dialog, sees a **dry-run preview** of the exact keystroke sequence that would land in the session's tmux pane (including any prefix / suffix framing), confirms, and observes the receiving Claude session pick up the task at its next prompt boundary. The submission emits a `task.submitted` timeline event with `session_id`, `pane_ref`, `body_len`, `body_sha256`, `by=owner`, and `channel=web`. A submission history drawer per session lists prior submissions with timestamps and outcomes ("delivered", "delivery failed — pane closed", "delivery failed — session released control mid-submit"). No task ever reaches a session where `state='observer'` or where the shim never registered — the button does not render, and even if the corresponding endpoint were called by a hand-crafted request, the core refuses with a 409.

---

## Scope (requirements-level; no implementation tasks)

| In | Out (and why) |
|---|---|
| **Submit-task endpoint** — `POST /actions/sessions/:session_id/submit-task` under the standard three-layer envelope (Bearer + Origin + Idempotency-Key + `serialize("session.submit", session_id)` + `withTimeline` emitting `task.submitted` / `task.submit.failed`). Payload: `{body, framing?, dry_run?}`. Refuses `state!='controlled'` (409, reason). Refuses `shim_registered=false` (409, reason). Refuses when `pane_ref` is unresolvable at dispatch time (409, `pane_gone`). Refuses `body` > a bounded max (16 KB default, config-knobable). | Multi-session broadcast ("submit this to all controlled sessions in this project") — out of scope. Cross-machine submission — Remote Control surface. |
| **Dry-run preview** — same endpoint, `dry_run=true` returns `{plan, resolved_target, keystroke_bytes, warnings}` without executing; the panel always calls this first and shows the preview to the owner; the confirm button POSTs `dry_run=false` with the same `Idempotency-Key`. | A "no preview needed for short tasks" fast path — every submission is previewed to the owner, no shortcut. |
| **Core-side send-keys executor** — one function inside the core (`apps/core/src/sessions/submit.ts`) that shells out to `tmux send-keys -t <resolved_target> -l <body>` followed by `tmux send-keys -t <resolved_target> Enter`. The `resolved_target` is looked up from `tmux_panes` by `session_id` at dispatch time (never taken from the request body). If the resolved target has moved (pane closed, session re-parented), the executor refuses without sending anything. | `send-keys` with hex escapes, control sequences, or arbitrary key names — the executor is deliberately restricted to a literal-text payload + a single `Enter`. Any richer keystroke sequence is a v1.1 opt-in. |
| **Framing** — the endpoint accepts an optional `framing` enum: `none` (raw body), `prompt-boundary` (waits until the receiver is at its own prompt before delivering — implementation via a short pre-check on `pane_current_command`), `slash-command` (owner picks from a whitelist of recognised slash commands to reduce keystroke ambiguity). Default is `prompt-boundary`. | Arbitrary user-supplied framing scripts — enum-only. |
| **Submission history** — new table `task_submissions` (`id`, `ts`, `session_id`, `pane_ref_at_dispatch`, `body_sha256`, `body_len`, `framing`, `outcome`, `error?`). Read endpoint `GET /sessions/:session_id/submissions`. Panel renders in a drawer inside the Fleet/Observed card. | Storing full submission bodies indefinitely — bodies land in the timeline event payload (which the timeline retention policy already governs); the `task_submissions` row keeps only the hash + length so the history drawer stays cheap. |
| **UI: Submit-task dialog** — accessible from a "Submit task" button that renders only on cards where `state='controlled' && shim_registered=true && pane_ref!=null`. Dialog fields: task body (multiline textarea, char counter, 16 KB cap), framing enum (default `prompt-boundary`), dry-run preview inline (auto-refreshes on body change, debounced 500 ms), confirm button (disabled until the preview loads). Post-confirm, a toast confirms delivery; on failure, the toast shows the reason and links to the submission history drawer. | Rich composition (markdown preview, syntax highlight, attachments) — v1 is plain text; the receiving session sees exactly what the owner typed. |
| **Guardrails — always-visible reminders** — the dialog carries a persistent banner: "Submitting a task writes into the session's tmux pane. The session must be under panel control (Phase 15) and its shim must be registered." Two check-boxes ("I have Take-control on this session" — pre-checked when the card state confirms it, but rendered so the owner registers it visually) do NOT gate submission (they're advisory in v1); a future v1.1 may promote them to hard gates. | Fully-hidden "advanced mode" that skips the reminder — every submission runs through the same dialog. |
| **Timeline audit + provenance** — `task.submitted` events carry `body_len`, `body_sha256`, `pane_ref`, `framing`; `task.submit.failed` events carry `reason`. Panel's Timeline screen renders them with a distinct badge; owner can filter to just submissions per session. | Retaining the exact submitted body on the timeline forever — payload retention follows the existing timeline policy; sensitive content should be considered leaked at dispatch time regardless. |
| **Rollback story** — a submission cannot be un-sent. The dialog surfaces this fact ("submissions cannot be recalled once delivered"); the history drawer offers a "revert to the last known-good state of this session" affordance that is **explicitly out of scope for v1** (would require the panel to send a Ctrl-C or a `/reset` which crosses back into steering). Rollback for the whole phase is delete-the-endpoint + hide-the-button in a single revert commit. | In-flight-submission cancellation — none; the executor is fast enough that the send lands within the confirm click's animation. |

---

## Success criteria (proven at implementation time; forward-declared here)

- **F16-S1 (submit into a controlled session).** With a target session in `state='controlled'` and `shim_registered=true`, clicking Submit task → typing a body → confirming the preview delivers the body into the receiving session's tmux pane within 1 s of confirm. The receiving Claude picks up the text at its next prompt boundary and treats it as if typed directly. A `task.submitted` event lands on the timeline with matching `body_sha256`.
- **F16-S2 (refusal on observer).** With a target session in `state='observer'`, the Submit-task button does not render on the card, and a hand-crafted `POST /actions/sessions/:session_id/submit-task` returns 409 with body `{reason: "session-not-controlled"}`.
- **F16-S3 (refusal on shim-unregistered).** With a target session in `state='controlled', shim_registered=false`, the button does not render, and the endpoint returns 409 with body `{reason: "shim-not-registered"}`.
- **F16-S4 (dry-run is mandatory).** A POST with `dry_run=false` and no prior `dry_run=true` under the same `Idempotency-Key` returns 428 (Precondition Required) with body `{reason: "preview-required"}`. The panel enforces this ordering client-side too.
- **F16-S5 (pane-gone at dispatch).** Between dry-run and confirm, `tmux kill-pane` the target; the confirm POST returns 409 with body `{reason: "pane_gone"}` and does NOT send anything to any pane. The submission-history row is written with `outcome='pane_gone'`.
- **F16-S6 (release-mid-submit).** Between dry-run and confirm, click Release control on the target's card; the confirm POST returns 409 with body `{reason: "session-not-controlled"}` and does not send. The submission-history row is written with `outcome='released_mid_submit'`.
- **F16-S7 (submission history).** After F16-S1..F16-S6, `GET /sessions/:session_id/submissions` returns rows for every attempt with matching outcomes and hashes; the panel history drawer renders them in reverse-chronological order.
- **F16-S8 (verification-report proof).** The scenarios above are recorded end-to-end (per-step screenshots + narrative) as an HTML report EN+RU under `docs/reports/verifications/GSL-347/runs/03/index.html` per memory `web-verification-html-runs.md`. The report explicitly walks the refusal paths (F16-S2..S6) not just the happy path (F16-S1).

---

## Requirements

- **R16.1 — Submission is restricted to controlled sessions.** No path submits a task into a session with `state!='controlled'`; the button hides, the endpoint refuses with 409. Acceptance: F16-S2.
- **R16.2 — Submission is restricted to sessions with a registered shim.** No path submits into a session where the shim never checked in; the button hides, the endpoint refuses with 409. Acceptance: F16-S3.
- **R16.3 — Dry-run preview is mandatory.** Every submission previews the exact keystroke bytes to the owner; the endpoint enforces the ordering via the Idempotency-Key. Acceptance: F16-S4.
- **R16.4 — The core resolves the send target from the tmux map, never the request body.** The request carries `session_id` only; the executor looks up the pane at dispatch time. A stale pane triggers a 409, not a wild-send into a different pane. Acceptance: F16-S5.
- **R16.5 — Release-mid-submit aborts.** State transitions between preview and confirm are honoured; the confirm re-reads the state and refuses on `observer`. Acceptance: F16-S6.
- **R16.6 — Every submission is auditable end-to-end.** Timeline event with `body_sha256` + submission-history row with matching hash + outcome. Acceptance: F16-S1, F16-S7.
- **R16.7 — Executor payload is bounded and typed.** `body` is a literal-text UTF-8 payload capped at 16 KB (config-knobable); no control sequences, no key-name escapes, no `send-keys` flags beyond `-l` + a trailing `Enter`. Acceptance: covered by the executor implementation test suite; no v1 acceptance surface.
- **R16.8 — Workers remain visible tmux panes.** Owner memory `workers-visible-in-tmux.md` (2026-08-10) applies — this phase does NOT introduce a "background worker" that a submission targets invisibly. The receiver is always a visible pane the owner can see. Acceptance: F16-S1 (target is a visible Fleet card).
- **R16.9 — No steering primitives in v1.** No Ctrl-C, no `/reset`, no `/exit`, no scroll-back read, no in-flight cancellation. Any of these are Remote Control (Phase 6) territory. Acceptance: covered by the executor scope; not a runtime check.

---

## Tasks (epic `[Docs][Web] Observer-mode PRD (phases A-C)`, [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347))

Same PRD-delivery split as Phases 14 and 15 — [GSL-348](https://ainstance-labs.atlassian.net/browse/GSL-348) writes this file, [GSL-349](https://ainstance-labs.atlassian.net/browse/GSL-349) wires traceability. **No implementation tasks are listed here — Phase 16 is deliberately requirements-level in v1.** When the owner is ready to green-light implementation, a fresh implementation epic will decompose from the following seed:

1. **Schema + migration** — `task_submissions` table.
2. **Executor** — `apps/core/src/sessions/submit.ts` with the literal-text-only `send-keys -l` + `Enter` primitive.
3. **Endpoints** — `POST /actions/sessions/:session_id/submit-task` (dry-run + confirm modes), `GET /sessions/:session_id/submissions`.
4. **UI** — Submit-task button on eligible cards, dialog with mandatory preview, history drawer.
5. **Timeline event kinds** — `task.submitted`, `task.submit.failed`.
6. **Verification run** — `docs/reports/verifications/GSL-347/runs/03/index.html`.

---

## Non-goals (explicit, v1)

- Multi-session broadcast.
- Cross-machine submission (Remote Control surface).
- Rich composition, attachments, markdown-to-keystroke translation.
- Control sequences (Ctrl-C, arrow keys, key-name escapes).
- In-flight cancellation.
- Fully-hidden "advanced mode" that skips the dialog / preview.
- Any behaviour that presumes / requires an invisible / backgrounded worker (owner memory `workers-visible-in-tmux.md`).
- Un-send / revert / recall — submissions cannot be recalled.
- Auto-generated tasks (a rule that submits a follow-up task when a session goes idle) — v1 is owner-typed only.

---

## Dependencies

- **Phase 14** (observation) — need the `tmux_panes` map to resolve send targets and the Observed/Fleet cards to attach the Submit button to.
- **Phase 15** (runtime control) — HARD dependency; no submission ever runs against `state!='controlled'`. R16.1 + R16.5 rely on the Phase 15 state registry.
- **Phase 7 web control plane** (GSL-250) — three-layer write envelope + SSE broadcaster + AppShell.
- **Owner memories:** `workers-visible-in-tmux.md` (2026-08-10 — R16.8), `no-silent-default-decisions.md` (2026-08-08 — no auto-submit), `web-verification-html-runs.md` (2026-08-10 — HTML-report EN+RU convention), `no-ragged-context-to-owner.md` (2026-08-10 — the dialog explains itself in owner-legible terms, not plumbing shorthand).
- **Plugin migration program** (GSL-337) — *note only*: the executor's `send-keys` primitive is per-host tmux; if a future plugin ships a cross-host executor variant, that is a new phase, not a Phase 16 extension.

---

## Risks + open questions

- **Risk 1: The receiving session is in a state where typed text is destructive** (e.g. inside a REPL where the text would be `eval`'d, or the middle of the owner's own typing). *Mitigation:* the `prompt-boundary` framing default pre-checks `pane_current_command` and waits up to 5 s for the receiver to be at its prompt; if it isn't, the executor refuses with `outcome='not-at-prompt'`. Question: is 5 s the right wait, or does the owner want the executor to send anyway with a warning?
- **Risk 2: The owner types a task and walks away before confirm.** *Mitigation:* the confirm button is disabled until the preview loads, and the dialog does not auto-confirm. Question: should the dialog auto-close after N minutes of inactivity (default: no, per memory `no-silent-default-decisions.md`)?
- **Risk 3: The submission body carries a secret the owner didn't mean to send.** *Mitigation:* the preview shows exactly what will be typed; the timeline stores `body_sha256` + `body_len` (the full body lives in the timeline event payload subject to the retention policy). Question: should the dialog run a lightweight regex sweep for common secret shapes (AWS keys, Bearer tokens) and warn before confirm? Recommended default: yes, with the warning being advisory only (not a hard block).
- **Risk 4: `send-keys -l` still interprets a trailing newline in the body oddly.** *Mitigation:* normalise the body (strip trailing whitespace, then append a single Enter). Question: does the owner want the body to be typed verbatim including internal newlines (multi-line paste) or split into separate `send-keys` calls per line? Recommended default: verbatim, tmux handles multi-line send correctly.
- **Risk 5: Two owners (unlikely on a personal machine, but…) submit to the same session at once.** *Mitigation:* `serialize("session.submit", session_id)` ensures FIFO ordering; the second submission observes the first's outcome via history.
- **Risk 6: Confusion with Remote Control's steering.** *Mitigation:* the dialog banner explicitly names the boundary ("this is a task submission, not steering; for live keystrokes use Remote Control").
- **Risk 7: The executor's `tmux send-keys` shells out — a compromised body could inject shell metacharacters.** *Mitigation:* `tmux send-keys -l` treats the argument as literal text and does not interpret it as tmux commands; the shell layer is invoked with argv arrays (no `sh -c`); the body is bounded to 16 KB and validated as UTF-8. Question: should the executor additionally reject bytes below 0x20 except Tab and Newline? Recommended default: yes (rejecting Ctrl-* code points closes the last obvious escape).

Morning-digest questions (with recommended defaults):

- **Q1.** Prompt-boundary wait ceiling (5 s vs longer)? → **default:** 5 s.
- **Q2.** Auto-close-idle dialog (yes vs no)? → **default:** no.
- **Q3.** Secret-shape regex warning in the preview? → **default:** yes, advisory only.
- **Q4.** Body max (16 KB vs bigger)? → **default:** 16 KB (fits a substantial task, still bounded).
- **Q5.** Reject sub-0x20 bytes in the body? → **default:** yes.

---

## Sources

- Owner briefing 2026-08-16 (verbatim: "later, task submission from the web") — captured in the [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347) epic description.
- `docs/runbooks/gosleep-core.md` — sections 8 + 8.5 for the interception envelope Phase 16 builds on.
- `docs/prd/08-phase14-observer-mode-observation.md` — the tmux map that resolves send targets.
- `docs/prd/09-phase15-observer-mode-runtime-control.md` — the state registry that gates submission.
- `docs/prd/01-phase7-interactive-control-plane.md` — the three-layer write envelope reused here.
- Owner memory `workers-visible-in-tmux.md` (2026-08-10) — receivers are visible tmux panes.
- Owner memory `no-silent-default-decisions.md` (2026-08-08) — no auto-transitions in the submit path.
- Owner memory `web-verification-html-runs.md` (2026-08-10) — HTML-report EN+RU convention.
- Owner memory `no-ragged-context-to-owner.md` (2026-08-10) — dialog copy discipline.
- `docs/prd/03-phase9-plugin-orphan-rescue.md` … `07-phase13-plugin-e2e-shakedown.md` — plugin program (noted only; not a dependency for v1 submission).

---

*End of Phase 16 PRD (Observer mode part C — task submission from the web).*
