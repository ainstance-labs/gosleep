# GSL-393 — List-level variant click submits directly (keep dialog for free-text)

**Parent epic.** [GSL-388](https://ainstance-labs.atlassian.net/browse/GSL-388) — "[Core][Web] E2E run-01 findings — heartbeat + prompt-boundary + attribution + reopen + one-click".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/386 (parent epic #381).
**Branch.** `GSL-388-e2e01-findings`.
**Commit.** `f35fa33`.

## What run-01 found

`docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01/index.html` finding #5:
the Questions list showed each option as a clickable button under the hint "click a
variant to answer", but the click opened the Answer dialog with the option pre-filled
rather than submitting — the owner had to click the same variant a SECOND time inside
the dialog to actually submit. Two clicks for what the copy promised in one.

Minor severity — the flow works and is discoverable (the modal is unambiguous) — but
the hint on the list was misleading.

## Fix

`apps/web/src/screens/Questions.tsx`:
- The list-level `QuestionOptions.onSelect` callback now calls `sendAnswer(qid, label)`
  directly. The Answer dialog stays for the free-text / "Other" reply path, opened
  via the explicit "Answer" button.
- Hint copy updated from "click a variant to answer" to "click a variant to answer
  instantly".
- Added a `submitting?: boolean` prop to `QuestionOptions`. When true, every list-level
  variant button is disabled and the hint flips to "answering…" — a second click during
  an in-flight mutation cannot race the first (React 19's async handler window would
  otherwise fan out N in-flight POSTs). Parent passes `answerMut.isPending`.

## Tests

`apps/web/test/questionListVariantSubmit.test.tsx` — 3 new tests:
- Clicking a variant fires the callback with the bare label (contract check via
  `renderToStaticMarkup`); no `Answer q-` dialog markup in the rendered tree.
- `submitting=true` disables the buttons and swaps hint copy to "answering…".
- `submitting=false` / default keeps buttons enabled and shows the instant-hint.

Existing GSL-376 a11y test still passes — `aria-label={opt.label}` is preserved so
screen-reader / voice-control users can address a single option ("click Option A")
without the numbered prefix leaking into the accessible name.

## Files touched

- `apps/web/src/screens/Questions.tsx` — `QuestionOptions.submitting` prop + busy
  affordance; parent onSelect rewritten to fire `sendAnswer` directly.
- `apps/web/test/questionListVariantSubmit.test.tsx` — new (3 tests).

## Gates

- `bun x tsc -p apps/web --noEmit` — clean.
- `bun test apps/web` — 104/104 pass (including the 3 new + the existing GSL-376
  a11y suite that still checks the aria-label contract).
- Web build — `dist/` OK, 965 KB main chunk (unchanged vs baseline).
