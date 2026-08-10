# GSL-308 [Web] Answer dialog crash — capture textarea value before async setState

**Date:** 2026-08-10 (shift 77 / epic GSL-307 hotfix).
**Branch:** `GSL-307-web-hotfix`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-265 (React 19 SPA), GSL-287 (Questions screen dialogs).
**Origin:** functional-QA run `web-e2e-2026-08-10/runs/01` finding #1 (MAJOR).

## Part 1 — the story

The verifier drove the Answer dialog with free text via CDP and the whole `/questions`
route blanked with "Something went wrong" on the very first keystroke. Chrome console:
`TypeError: Cannot read properties of null (reading 'value')`, thrown from
`apps/web/src/screens/Questions.tsx:651-655` — the textarea `onChange` inside the Answer
dialog. Same shape of code lived in four sibling dialogs (Resolve, ApplyManifest override,
Defer customIso, Deny reason).

The pattern was:

```tsx
onChange={(e) =>
  setAnswerDialog((prev) =>
    prev === null ? prev : { ...prev, value: e.currentTarget.value },
  )
}
```

React 19 is free to invoke the state-updater function outside the synchronous handler
window. By the time the updater runs, the SyntheticEvent has been recycled and
`e.currentTarget` is null → TypeError → the router error boundary catches it and blanks
the panel until a full reload. The owner cannot answer any BLOCKER/DECISION from the web
until they reload.

The fix is one-line-per-handler: capture `e.currentTarget.value` into a local `v` inside
the synchronous handler body BEFORE calling the setter. The updater then closes over
`v`, not the recycled event.

```tsx
onChange={(e) => {
  const v = e.currentTarget.value;
  setAnswerDialog((prev) => (prev === null ? prev : { ...prev, value: v }));
}}
```

Applied identically to all five dialogs in `Questions.tsx`. Comment on each cites GSL-308
so a future reader knows why the two-line form exists.

**Why the QA harness surfaced it but manual typing sometimes did not.** React 19's async
scheduling triggers the recycle window more aggressively under scripted input than under
human typing latency; the QA harness ran a CDP-driven fill in one paint frame, which is
exactly the shape the recycle race needs. Under human typing the crash was intermittent
in earlier hands-on runs; the harness made it a guaranteed reproduce.

**Regression proof.** `apps/core/test/questions-onchange-regression.test.ts` models the
pattern under `bun:test`. It exercises a minimal state store that queues the updater and
dispatches it AFTER the event's currentTarget is nulled — matching the React 19 recycle
ordering. The pre-fix pattern throws `TypeError`; the fix pattern survives. Also covers
the null-prev case (dialog closed between keystroke and flush) and the classic React 18
synchronous path.

## Part 2 — technical reference

- **Fix commit:** this task's SHA (see git log).
- **Files:**
  - `apps/web/src/screens/Questions.tsx` — five textarea/input `onChange` handlers
    rewritten to capture-then-update.
  - `apps/core/test/questions-onchange-regression.test.ts` — regression test (4 cases,
    covers pre-fix throw, fix survival, sync path, null-prev).
- **Gates:**
  - `bun x tsc -p apps/web --noEmit` clean.
  - `bun x tsc -p apps/core --noEmit` clean.
  - `bun test` in `apps/core` — 232 pass (228 baseline + 4 regression), 0 fail.
  - `bun run --filter='@gosleep/web' build` clean (dist/index.html + assets).
  - `bash tools/lab/tests/core-smoke.sh` — 102 pass (unaffected by this task).
- **Where the answer dialog surfaces the crash again if regressed:** owner opens a
  BLOCKER/DECISION on `/questions`, clicks **Answer**, types anything into the textarea
  → whole route blanks. The bun regression test catches the class of bug before it can
  reach the browser.
- **Non-goals:** other free-text form controls outside `Questions.tsx` — audit is queued
  as a shift-close item, not in this hotfix scope.

## Comments

- No skill lessons this shift beyond what handoff shift 77 will record — the React 19
  state-updater recycle window is a React-version fact, not a delivery-workflow lesson.
