# GSL-377 — Answer dialog: options snapshot goes stale under SSE mutation

**Parent epic.** [GSL-387](https://ainstance-labs.atlassian.net/browse/GSL-387) — "[Core][Web][Tooling] Shift-79 verifier follow-up bundle".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/367 (parent epic #377).
**Branch.** `GSL-387-verifier-followups`.

## What changed

The GSL-370 verifier flagged `AnswerDialogState.options` as a snapshot captured at dialog open time. Any SSE-driven mutation of the underlying question (options edited / removed / re-ordered) while the dialog is on-screen leaves the owner answering against a stale option set — submissions may reference option ids or indices that no longer exist server-side. The fix must produce a **defined, non-silent** behavior, not a stale submission.

Approach chosen: **prescription #1 (re-derive on every render + explicit banner)**, with the auto-close fallback for the vanished-question case.

## Fix

`apps/web/src/screens/Questions.tsx`:

- `AnswerDialogState` gains an `openedOptionsSig: string` field — the signature of the options snapshot at open time.
- New exported helper `optionsSignature(NormalizedOption[] | null): string` — content-based hash of the label + description of each option in order. Pros/cons drift is INTENTIONALLY tolerated (advisory metadata, not tied to the submitted answer).
- Both dialog-open call sites (queue-row option click and full-dialog Answer button) now compute and store `openedOptionsSig` at open time.
- New `useMemo` on `[answerDialog, q.data]` computes `liveAnswerQuestion` — the current row from the live query. `liveAnswerOptions` derives the normalized options from it.
- `answerOptionsStale` is true when the dialog is open AND the live question exists AND its option signature differs from `openedOptionsSig`.
- New `useEffect` — when the dialog is open and the live question row has vanished (answered/resolved via another channel), auto-close with a `warn` toast: "Question <qid> closed while the dialog was open".
- `reloadAnswerDialogFromLive` — resets the dialog to the fresh live options; called by the banner's Reload button. Preserves the owner's typed text unless it matched a stale option label, in which case it clears (the label may no longer be a valid variant).
- Answer dialog render adds a `role="alert"` banner (`data-testid="answer-dialog-stale-banner"`) that appears while stale. It has a Reload button (`data-testid="answer-dialog-stale-reload"`).
- Both submit paths (the top-level Send button + the per-variant buttons) refuse while stale — `disabled` is OR-composed with `answerOptionsStale`.

Rationale: the banner path is preferred over auto-close because losing typed input mid-answer is worse than a one-click Reload confirmation.

## Files touched

- `apps/web/src/screens/Questions.tsx` — signature helper (exported), AnswerDialogState field, dialog-open call sites, useMemo/useEffect/reload helper, banner + button gating.
- `apps/web/test/answerDialogStaleOptions.test.ts` — 9 assertions on the signature helper: null/empty equivalence, identity under equal content, drift detection for reorder/add/remove/rename/description-edit, pros/cons drift tolerated, integration with normalizeOptions.

## Verification

- `bun test test/answerDialogStaleOptions.test.ts` — **9 pass / 0 fail (12 expects)**.
- `bun test test/questionOptionsA11y.test.ts` — **4 pass / 0 fail (13 expects)** — GSL-376 unchanged by this task.
- `bun x tsc -p apps/web --noEmit` — clean.
- Live browser proof: `docs/reports/verifications/GSL-377/runs/01/` — separate deliverable in this task (scratch core on 127.0.0.1:7356, panel driven via chrome-devtools MCP on CDP :9256).

## Notes / decisions

- The pros/cons drift toleration is a deliberate choice — normalizing pros/cons string→array via `normalizeOptions` MUST NOT fire the banner. Only label + description matter for a stale answer.
- The signature format is intentionally opaque (`export`ed only for the test) — downstream code should not depend on the exact string.
- The vanish-mid-flight path (question row disappears from `q.data.questions`) auto-closes rather than banners; there is nothing to reload from, and the toast surfaces the reason.
- The action buttons (Send + per-variant) gate on staleness in ADDITION to `answerMut.isPending`; the pre-existing empty-textarea check on the Send button is preserved.
