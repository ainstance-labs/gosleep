# GSL-383 — Web Submit-task button + dialog + submission-history drawer

**Epic:** GSL-378 · **Branch:** `GSL-378-observer-task-submission` · **Base:** `origin/main` @ `a52b302`.

The panel-facing surface for observer-mode Phase C. Owner opens a Fleet card, presses
**Submit task**, types a body in a dialog with a live-refreshing dry-run preview,
confirms — the receiving Claude session sees the body typed at its next prompt. Each
card also carries a **History** drawer surfacing the last-N submissions from that
session's `task_submissions` rows.

## Components

- `apps/web/src/components/SubmitTaskDialog.tsx` — the modal dialog. Owns its own body
  + framing + preview state; debounces (500 ms) a `dry_run=true` POST on every body /
  framing change; keeps the CURRENT `Idempotency-Key` so the eventual confirm can reuse
  it (F16-S4 preview-required). Send button is DISABLED until (a) a preview is loaded
  for the current body_sha256, AND (b) the "cannot be recalled" checkbox is ticked.
  Also runs a client-side secret-shape sweep so the AWS / sk- / sk-ant- / ghp_ / JWT /
  Bearer warnings appear even before the server preview lands.
- `apps/web/src/components/SubmissionHistory.tsx` — TanStack Query drawer over
  `useSubmissions(sessionId, limit=25)`. Renders each row as `<time-ago> <outcome-pill>
  <bytes · framing · pane_ref · error> <sha16>`. Never shows body text (R16.6).
- `apps/web/src/data/queries.ts` grew `useSubmissions(sessionId, limit?)` +
  `useSubmitTask()`. The mutation deliberately does NOT auto-mint an idempotency key
  — the dialog owns it so the confirm phase reuses the preview's key.
- `packages/sdk` — added `.submissions(sessionId, limit?)` reader and
  `.submitTask(sessionId, input, idempotencyKey)` writer.
- `apps/web/src/screens/Fleet.tsx` — extracted a `<FleetCard s={s}>` component so each
  card owns its own submit-dialog + history-drawer state. Renders the **Submit task**
  button only when `state='controlled' && shim_registered=true && tmux_pane_ref!=null`
  (PRD § Scope UI — button HIDES on ineligible cards; no disabled tooltip). The
  **History** button is always visible on non-ended cards (submissions may exist for a
  session that has since been released).

Observed cards are NOT wired in this task — the `/observed/sessions` response does not
surface `tmux_pane_ref` today, so the visibility gate would hide the button on every
Observed card. Extending `/observed/sessions` with the joined pane ref is a small
follow-up if the owner wants the button on both surfaces.

## SSE routing

Already wired in GSL-382 for the timeline events; recap for GSL-383's UI surface:

- `sessions.submissions.updated` (synthetic frame the endpoint fires from every
  confirm) → invalidate `["core", "submissions"]` → drawer refreshes within the 250 ms
  coalesce window.
- `task.submitted` / `task.submit.failed` → invalidate `submissions` + `fleet` + hits
  the always-invalidate `timeline` bucket.

## Tests

`apps/web/test/submitTaskDialog.test.ts` — 7 unit tests for the two exported
helpers (`utf8Bytes` and `scanForSecretShapesClient`). The dialog itself is React
inside a Radix Portal and lives outside bun:test's happy path (no DOM harness for
Radix modals under bun:test today); the endpoint's E2E behaviour is proven by the 17
endpoint tests from GSL-381 + GSL-382. Full apps/web suite: 88/0. Full apps/core:
401/0. Web build: clean (single 962 KB chunk warning is pre-existing).

## Live browser-driven proofs

`.artifacts/live-e2e/` scratch tree (torn down; not committed): bespoke SQLite +
scratch core on **port 7354** (never prod 7331) + `apps/web/dist` served by the same
core + `browse` headless Chromium.

Evidence under `docs/dev_history/assets/GSL-383/`:

- `panel-01-fleet-cards.png` — Fleet screen with the seeded `sess-live-1` card visible
  alongside 199 other observer-only rows.
- `panel-02-submit-dialog-empty.png` — freshly-opened dialog: title, warning banner,
  empty textarea (0 / 16,384 bytes), target pane `gsl378-target:@37.%406`, framing
  dropdown, "idle" preview, two advisory checkboxes.
- `panel-03-submit-dialog-preview-ready.png` — after typing "panel: browser-driven
  submit-task proof": bytes=39, sha16=5401e9d5cd174035_, framing=prompt-boundary,
  preview badge `ready` (green), keystroke bytes in the monospace panel.
- `panel-05-after-confirm.png` — Fleet after clicking Send task.
- `panel-06-history-drawer.png` + `panel-07-history-drawer-closeup.png` — History
  drawer showing 3 rows for `sess-live-1`: 32-sec-old `delivered` (green pill, 39 b,
  prompt-boundary, pane_ref, sha16), 4-min-old `pane_gone` (amber pill, 15 b), 4-min-
  old `delivered` (green pill, 52 b).
- `panel-08-timeline.png` — Timeline screen.
- `panel-09-dialog-with-warning.png` — proof of the client-side secret-shape sweep:
  body `set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE and rerun` → advisory yellow
  warning "Body contains something shaped like an AWS access key ID (AKIA/ASIA + 16
  chars)."  Send stays disabled while the "cannot be recalled" checkbox is unchecked.
- `tmux-capture-after-happy-path.txt` — real tmux pane capture showing both bodies
  landed in the bash prompt (from the cURL round + the browser round).
- `task_submissions-rows.txt` — `SELECT * FROM task_submissions` snapshot: 3 rows,
  outcomes `delivered`/`pane_gone`/`delivered`, matching hashes.
- `timeline-events.jsonl` — the JSONL side of GSL-382 timeline events: one
  `task.submitted` and one `task.submit.failed` line with full payload (session_id,
  submission_id, outcome, body_len, body_sha256, framing, pane_ref, by, channel,
  error, body).

## Safety rails observed during the live proof

- Scratch tmux session prefixed with `gsl378-target` (never touched a foreign pane —
  the executor's `resolvePaneRef` reads only the seeded `tmux_panes` row).
- Scratch core on port 7354 (mission-mandated), never touched prod 7331.
- Scratch DB / lab under `.artifacts/live-e2e/` (git-ignored via `.artifacts/`).
- `browse` closed with `stop`; scratch core killed via `SERVER_PID`; scratch tmux
  killed via `tmux kill-session -t gsl378-target`; port 7354 verified free.

## Follow-ups

- Extend `/observed/sessions` to join `tmux_panes` for `pane_ref` so the Observed
  screen can render the Submit-task button too.
- Consider a "diff preview against last submission" affordance in the drawer (out of
  scope for v1; PRD § Non-goals covered).
- The Submit dialog currently sends the raw body straight to `dry_run` on every
  keystroke debounce. A prior request that came back with `preview-required` (unlikely
  — only fires on confirm) does not surface as a red banner today. If v1.1 wants
  hard-gate ("Take-control" checkbox becomes a real gate, not advisory), that's a
  ~10-line change in `SubmitTaskDialog.canConfirm`.
