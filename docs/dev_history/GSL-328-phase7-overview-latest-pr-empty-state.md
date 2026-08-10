# GSL-328 — Overview Latest-PR card empty-state

**Epic:** GSL-326 · **Branch:** `GSL-326-cosmetic-polish` · **Base:** `origin/main` @ `394cc6e`.

## Symptom (E2E run 08 baseline S1)

Run 08 spun up a pristine core (no session had emitted `last_pr_url` yet)
and pointed Playwright at the Overview. Locator count for the string
"Latest PR" came back as **0** — the card wasn't muted, wasn't disabled,
it simply wasn't in the DOM. From the operator's chair that reads as
"the surface is missing", not "there's nothing to show yet".

The prior render logic:

```tsx
{(() => {
  const pr = fleet.data !== undefined ? pickLatestPr(fleet.data.sessions) : null;
  return pr === null ? null : <LatestPrCard pr={pr} />;
})()}
```

## Fix

- Widened `LatestPrCard`'s prop type to `PrObservation | null`.
- Card is now always rendered; when `pr === null`, the body swaps to a
  muted empty-state ("No pull requests yet. The card populates as soon
  as a fleet session runs `gh pr create` (or `gh pr view <url>`)."),
  which also documents to the operator how the population mechanism
  works.
- The Overview call-site drops the ternary and always emits
  `<LatestPrCard pr={pr} />` — the child is now the single owner of the
  empty/populated toggle.
- Added `data-testid="latest-pr-card-empty"` to the empty variant so
  future E2E can assert the card is present without depending on the
  populated anchor.

## Consistency

Runway + KPI tiles on Overview already keep their frame when their
underlying counter is zero; this brings Latest PR in line with the same
"always visible, gracefully empty" convention. Muted colour is driven by
existing tokens (`text-muted`), so both light and dark themes stay
consistent without any theme-specific overrides.

## Gates run

- `bun x tsc -p apps/web --noEmit` — clean.
- `bun run --filter='@gosleep/web' build` — clean.

## Live proof

`docs/dev_history/assets/GSL-328/s1-overview-empty-state.png` — pristine
Overview on the worktree-local scratch core (127.0.0.1:7352); no seeded
session had `last_pr_url` populated. The card is visible with the muted
empty-state copy.

Playwright driver assertions (`tools/e2e/scenarios/gsl-326/run.mjs`
step 1):

| assertion                                                | count |
|----------------------------------------------------------|-------|
| `[data-testid="latest-pr-card-empty"]`                   |   1   |
| `text=/No pull requests yet/`                            |   1   |
| `text=/Latest PR/` (card title still present)            |   1   |

All three were `0` on `main` @ 394cc6e (run 08 baseline S1).

## Files touched

- `apps/web/src/screens/Overview.tsx` — `LatestPrCard` prop widen +
  empty-state branch; Overview call-site drops the null-ternary.
