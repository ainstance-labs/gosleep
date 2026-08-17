# GSL-402 [Web] Submit-task dialog: pending-question banner

## What

Resolves E2E run-03 finding m2: with the fixture parked on a pending AskUserQuestion,
opening Submit task on that session's Fleet card produced the normal preview modal — no
banner, no chip, no colour cue. Submission succeeded (`outcome=delivered`) and Claude
Code queued the text under "Press up to edit queued messages" until the question
resolved — no data loss — but if the owner intended the text as an ANSWER to the
question, it would silently miss the AskUserQuestion tool_input and land as a follow-on
prompt.

## Fix

Two small additions to `apps/web/src/components/SubmitTaskDialog.tsx`:

1. **`SubmitTaskPendingQuestionBanner`** — new stateless sub-component that renders a
   short advisory sentence styled with the same warn tokens as the persistent
   guardrails banner. Exported so a unit test can render it via `react-dom/server`
   without booting the Radix Portal (portals do not render in `renderToStaticMarkup`).
2. **`hasOpenQuestion?: boolean`** — new optional prop on `SubmitTaskDialogProps`.
   When `true`, the banner renders ABOVE the persistent guardrails banner so the
   contextual "this will queue behind an open question" note lands before the operator
   reads the always-on submitting semantics. Non-blocking: Send stays enabled; the
   banner is advisory. Default `false` preserves pre-GSL-402 behaviour verbatim.
3. **Banner text** — exported as `PENDING_QUESTION_BANNER_TEXT` constant so tests,
   docs, and any future E2E harness can grep for the exact sentence. Current wording:
   `"This session has an open question — the text will queue until the question is
   answered."`

`apps/web/src/screens/Fleet.tsx` passes
`hasOpenQuestion={s.current_tool === "AskUserQuestion"}` to the dialog. Post-GSL-401
the /fleet-side `current_tool` is reliably NULLed when the tool exits, so a truthy
match here means the session is actively long-polling on an owner answer. The two
fixes compose: without GSL-401 the banner would keep showing after the question is
answered; with GSL-401 the banner appears exactly during the pending window.

## Tests

`apps/web/test/submitTaskDialogPendingQuestion.test.tsx` — 3 assertions on the
banner surface:

- Renders the fixed advisory sentence exactly (constant + rendered HTML pinned).
- Carries `data-testid="submit-task-pending-question-banner"` so an E2E harness
  can grep for the state without a visible-text match.
- Uses `role="note"` to match the sibling guardrails banner (screen-reader parity).

Before the fix, all 3 tests fail — the exported symbol does not exist. After, all
3 pass. Existing `submitTaskDialog.test.ts` (utility tests) unchanged and green.

## Choice of signal: `s.current_tool === "AskUserQuestion"`

The `questions` DB table has no `session_id` column, so a direct per-session
`GET /questions?session_id=<sid>` query is not available. `s.current_tool` (from
`/fleet`) is the closest reliable server-side signal:

- Set by `tools/hooks/tool-observed-feed.sh` in the PreToolUse{AskUserQuestion}
  code path (see `ask-user-question-hook.sh` line 244).
- Cleared by the PostToolUse{AskUserQuestion} wiring landed in GSL-401 (the sibling
  task in this epic).
- Refreshed on the /fleet SSE fan-out that already invalidates the FleetCard's
  query.

If the questions table gains a `session_id` column in a future migration, replace
the derivation on the Fleet.tsx side; the SubmitTaskDialog prop contract does
not have to change.

## Rollback

Remove the `hasOpenQuestion` line in Fleet.tsx (revert to the pre-GSL-402 prop set)
and the dialog will never render the banner. The `SubmitTaskPendingQuestionBanner`
export can stay — it is dormant without a caller — or be dropped in the same
revert if a clean rollback is preferred.

## References

- Report: `docs/reports/verifications/harness-web-e2e-2026-08-17/runs/03/index.html` — finding #2.
- Jira: GSL-402 under Epic GSL-400.
- GH mirror: ainstance-labs/gosleep#399.
- Composes with GSL-401 (PostToolUse tool-observed clear).
