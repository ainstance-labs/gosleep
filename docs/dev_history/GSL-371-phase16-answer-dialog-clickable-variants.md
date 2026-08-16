# GSL-371 — Answer dialog: clickable variant options

**Epic:** GSL-370 · **Branch:** `GSL-370-panel-ux-polish` · **Base:** `origin/main` @ `253cb38`.

The web panel's Answer dialog let the owner do exactly one thing: type a free-text
answer, then click "Send answer". Even when the question's payload shipped a
structured `options: [{label, description?, pros?, cons?}]` list, those variants
were displayed as a static bullet list — the owner had to read the JSON, decide,
then retype the label they wanted verbatim into the textarea. A one-click answer
took roughly four steps.

GSL-371 makes variants first-class clickable answers on two surfaces:

1. **The question card itself.** `QuestionOptions` in the row now renders each
   variant as a `<button>`. Clicking one opens the Answer dialog with that
   label prefilled — the owner gets a beat to add notes or cancel. This is
   the "read the row, decide from context, act" flow.
2. **Inside the Answer dialog.** A `Pick a variant (submits immediately)`
   row above the textarea renders one button per option. Clicking submits
   the label straight through the answer path, bypassing any textarea edit.
   This is the "I've already decided, just do it" flow.

Free-text still works: the textarea is unchanged, the "Send answer" button
still submits its contents, and rows with no options / with a bare-string
`options` payload fall through to the same free-text-only path they had
before (feature-parity for the unstructured case).

## Files

- **New** `apps/web/src/lib/questionOptions.ts` — `normalizeOptions(unknown)` +
  `hasClickableOptions(unknown)`. Coerces the wire-shape into a
  `NormalizedOption[]` (or `null` when the shape is not clickable). Extracted
  from the old `looksLikeOptionArray` + `stringList` helpers that used to live
  inside `Questions.tsx` so the coercion rules can be covered by a plain
  `bun test` unit test independent of the DOM.
- **New** `apps/web/test/questionOptions.test.ts` — 7 tests: labels-only list
  is clickable; pros/cons string variants are coerced to arrays; malformed
  items reject the whole payload; non-array / empty / string payloads reject;
  `hasClickableOptions` mirrors `normalizeOptions` success; labels are
  trimmed and blank-after-trim rejects.
- **Edited** `apps/web/src/screens/Questions.tsx`:
  - `AnswerDialogState` gained an `options: NormalizedOption[] | null` field
    so the dialog knows whether to render the variant button row.
  - `QuestionOptions` gained an `onSelect: ((label: string) => void) | null`
    prop; when non-null, each option row becomes a keyboard-accessible
    `<button>` that bubbles the selected label to the parent.
  - Extracted `sendAnswer(qid, answer)` so the "Send answer" button and the
    per-variant buttons in the dialog share one submission path.
  - Deduplicated `looksLikeOptionArray` / `stringList` — the new lib is the
    single source of truth.

## Wire-shape rules (from `normalizeOptions`)

- Item must be a plain object with a non-empty string `label` after trim.
- `description` accepted as a non-empty string; anything else → `null`.
- `pros` / `cons` accepted as `string[]` OR a single `string`; anything else
  → empty `[]`.
- Any malformed item rejects the WHOLE list — a partially clickable list
  hides which rows would submit and which would not, so we fall back to
  the free-text path if we cannot promise every variant works.
- A bare-string `options` payload (`"pick one of these"`) renders as
  prose, not as a variant button (unchanged from GSL-314's behaviour).

## Gates (worktree)

- `apps/web/node_modules/.bin/tsc -p apps/web --noEmit` — clean.
- `bun test apps/web/test` — 64 pass / 0 fail (7 new).
- `bun run --filter='@gosleep/web' build` — 949 kB bundle (unchanged
  shape; +~1 kB from the new lib + inlined variant row).

## Live-fire proof

Scratch `apps/core` booted on port 7348 (7346 was in use by the concurrent
GSL-288 worker; ports 7347 also busy — 7348 was the first free port on the
ladder) with a hermetic `.artifacts/gsl370-scratch/` DB + lab dir under a
dev-env Bearer. Seeded question `q-gsl370-live-001` with three variants
(`Option Alpha` / `Option Bravo` / `Option Charlie`). Chrome-devtools MCP
drove the panel through the two surfaces:

1. **Card variant → dialog prefill.** Clicked `Option Alpha` on the
   question card → Answer dialog opened with the textarea prefilled
   `Option Alpha`. Screenshot:
   `assets/GSL-371/01-question-card-clickable-variants.png`,
   `assets/GSL-371/02-answer-dialog-prefilled-and-variant-buttons.png`.
2. **In-dialog variant → direct submit.** Clicked `Option Bravo` inside
   the dialog. The panel bypassed the textarea's prefilled `Option Alpha`
   and submitted `Option Bravo` — proving the in-dialog buttons take
   precedence over the textarea contents (that's the point of the
   "Submits immediately" affordance).

Scratch DB after the submit:

```
qid=q-gsl370-live-001  status=answered  answer_text='Option Bravo'
                       answered_at=2026-08-16T19:03:07Z
events: seq=1 ts=2026-08-16T19:03:07Z actor=owner-web type=question.answered
```

Screenshot of the answered row:
`assets/GSL-371/03-answered-option-bravo.png`.

Teardown: core PID killed cleanly, ports 7348 / 9246 free after run.
