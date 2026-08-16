# GSL-376 — Answer dialog options: add `aria-label` with the bare option label

**Parent epic.** [GSL-387](https://ainstance-labs.atlassian.net/browse/GSL-387) — "[Core][Web][Tooling] Shift-79 verifier follow-up bundle".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/366 (parent epic #377).
**Branch.** `GSL-387-verifier-followups`.

## What changed

The GSL-370 verifier flagged that each option `<button>` in the QuestionOptions component concatenates label + description + pros + cons inside its children. Without an explicit `aria-label`, the accessible name derived from that content is the whole blob — screen readers announce all of it, and voice-control users cannot say "click Option A" because the assistive tech never sees "Option A" alone.

Fix: added `aria-label={opt.label}` to two option-button surfaces in `apps/web/src/screens/Questions.tsx`:

1. The clickable `<button>` inside the `QuestionOptions` component (used in the queue row). Previously accessible name = label + description + pros/cons blob → now = bare label.
2. The variant `<Button>` inside the answer dialog. This already had `<span>{idx+1}.</span> <span>{opt.label}</span>` so the accessible name was `"1. Option A"` — added `aria-label={opt.label}` for parity with the queue-row buttons; voice-control now addresses "Option A" without the numeric prefix leaking in.

The rich visible body is unchanged — sighted users still see label + description + pros/cons + numeric prefix. The `aria-label` is additive, not a replacement.

## Files touched

- `apps/web/src/screens/Questions.tsx` — added `aria-label={opt.label}` to two option-button render sites; exported `QuestionOptions` so it becomes testable.
- `apps/web/test/questionOptionsA11y.test.tsx` — new test file with 4 assertions:
  1. Clickable option buttons carry `aria-label` = bare option label (regex + exactly-once).
  2. Sighted body still renders label + description + pros + cons text.
  3. Non-clickable variant (`onSelect = null`) renders `<div>` rows, no `<button>`, no `aria-label`.
  4. `normalizeOptions` + `QuestionOptions` round-trip preserves the `aria-label` (belt-and-braces against a label-mangling regression).

Tests use `renderToStaticMarkup` from `react-dom/server` (already in `apps/web`'s dep tree) — no new dependency required.

## Verification

- `bun test test/questionOptionsA11y.test.tsx` — **4 pass / 0 fail (13 expect calls)**.
- `bun x tsc --noEmit` (apps/web) — clean.

## Notes / decisions

- Considered `aria-labelledby` pointing at a hidden label span. Chose the direct `aria-label` for simpler render + no extra DOM node. The trade-off (label becomes a duplicated string in JSX) is negligible.
- `QuestionOptions` was `function QuestionOptions(...)`; promoted to `export function ...` to make the test possible without a separate extraction. No other change to its behavior or public API.
- The queue row also has a `<div>`-only fallback when `onSelect === null`. That path does not need `aria-label` — nothing screen-reader-focusable renders. The test asserts this negative.
