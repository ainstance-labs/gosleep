# GSL-379 — task_submissions table + drizzle 0007 migration + schema types

**Epic:** GSL-378 · **Branch:** `GSL-378-observer-task-submission` · **Base:** `origin/main` @ `a52b302`.

Foundation for Phase 16 (observer-mode task submission from the web). Adds one new table
— `task_submissions` — the per-submission history the panel's Fleet/Observed drawer reads
and the submit-task endpoint writes to on every confirm.

Migration `apps/core/drizzle/0007_task_submissions.sql`:

- `task_submissions(id PK TEXT, ts TEXT NOT NULL, session_id TEXT NOT NULL,
  pane_ref_at_dispatch TEXT, body_sha256 TEXT NOT NULL, body_len INTEGER NOT NULL,
  framing TEXT NOT NULL, outcome TEXT NOT NULL, error TEXT)`.
- Indexes `ix_task_submissions_session_ts (session_id, ts)` for the drawer's per-session
  history query, and `ix_task_submissions_ts (ts)` for a future cross-session admin view.
- All additive per R28 — no DROP; the migration chain is forward-only.

The row deliberately stores NEVER the body text itself: R16.7 caps `body` at 16 KB and
R16.6 keeps the full body on the timeline event payload (subject to that layer's retention).
This row keeps only sha256 + byte length so the panel history drawer stays cheap. The
outcome enum encodes every path a submission can take through the executor: `delivered` |
`pane_gone` (F16-S5) | `released_mid_submit` (F16-S6) | `not_at_prompt` (Risk 1 with Q1's
5-second default) | `send_failed` (rare tmux send-keys nonzero). The framing enum mirrors
R16 scope: `none` | `prompt-boundary` (default) | `slash-command`.

## Schema package types (@gosleep/schema)

Added zod schemas + inferred TS types for both storage and wire surfaces the later tasks
will consume:

- `SubmissionFraming`, `SubmissionOutcome` — string-enum guards (`.or(z.string())` at the
  read boundary so a future enum value doesn't SchemaError the SDK, following the same
  drift-tolerant pattern the QuestionStatus schema uses).
- `TaskSubmissionRow` / `TaskSubmissionsResponse` — the shape of a row on the wire and the
  shape of `GET /sessions/:id/submissions`.
- `SubmitTaskActionInput` — shared body validator for BOTH dry-run and confirm posts
  (`body`, `framing?`, `dry_run: boolean`, `by?`, `channel?`).
- `SubmitTaskPreviewResult` — `{resolved_target, keystroke_bytes, body_len, body_sha256,
  framing, warnings[], previewed_at}` returned by `dry_run=true`.
- `SubmitTaskConfirmResult` — `{submission_id, session_id, outcome, pane_ref_at_dispatch,
  body_len, body_sha256, framing, ts, error}` returned by `dry_run=false`.
- `SubmitTaskActionResult` = discriminated union of the two; `SubmitTaskActionResponse` =
  the standard `actionResponse<T>(...)` envelope around the union.

`SubmissionWarning` (a `{code, message}` pair) is the shape the preview's regex sweep for
common secret shapes (Risk 3, Q3 default: yes, advisory only) will produce in GSL-381.

## Migration workflow notes

- `bun x drizzle-kit generate --name=task_submissions` in `apps/core/` produced a broken
  migration file that recreated four already-existing tables and re-issued five already-
  applied ALTER TABLE statements. The cause: `apps/core/drizzle/meta/` has snapshots for
  0000 and 0001 only, and the runtime migrator reads `_journal.json` + `*.sql` (not the
  snapshots). Prior migrations 0002..0006 were hand-authored SQL — 0006_session_control
  is the immediate template. Following that convention: kept the auto-generated
  `_journal.json` entry (with a monotonic `when` timestamp), deleted the auto-generated
  `0007_snapshot.json`, and rewrote `0007_task_submissions.sql` to add only the new
  table + indexes.

## Tests

The 356 apps/core tests continue to pass after the schema addition. No new tests were
authored under this task — `task_submissions` is a foundational schema addition with no
runtime writer yet (the writer lands in GSL-380/381 with dedicated executor + endpoint
tests).

## Follow-ups

- GSL-380 will implement the executor (`apps/core/src/sessions/submit.ts`) that writes
  rows into this table under the safety envelope.
- GSL-381 will surface the reader (`GET /sessions/:id/submissions`) + the writer
  (`POST /actions/sessions/:id/submit-task`) that share this schema.
