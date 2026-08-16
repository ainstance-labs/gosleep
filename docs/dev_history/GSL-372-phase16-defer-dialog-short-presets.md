# GSL-372 — Defer dialog: add short duration presets

**Epic:** GSL-370 · **Branch:** `GSL-370-panel-ux-polish` · **Base:** `origin/main` @ `253cb38`.

The web panel's Defer dialog used to expose exactly six presets — `No timer`,
`30 minutes`, `2 hours`, `Tomorrow 10:00`, `Next Monday 10:00`, `Custom ISO`.
For a genuinely short pause the owner had to fall through to the custom-ISO
picker (which meant typing a full `YYYY-MM-DDTHH:MM:SSZ` string by hand) or
pick `30 minutes` when they wanted five. The panel E2E runs
(`docs/reports/verifications/web-e2e-2026-08-10/runs/*`) noted this friction.

GSL-372 adds three short presets — `5 minutes`, `15 minutes`, `1 hour` — at
the front of the ladder, in ascending order. Long presets and the two escape
hatches (`No timer` / `Custom ISO`) are unchanged. Clicking a short preset
commits the same defer path the long presets already used
(`POST /actions/questions/defer` → `defer_until` ISO → `question.deferred`
event → panel countdown).

## Files

- **New** `apps/web/src/lib/deferPresets.ts` — extracted the preset ladder
  ordering (`DEFER_PRESET_ORDER`), the relative-duration map
  (`DEFER_RELATIVE_SECONDS`), and the resolver
  (`resolveDeferPreset(key, custom, now) → string | null`) from the JSX.
  `now` is an explicit `Date` argument so unit tests can pin the anchor
  without a `Date.now()` shim. `tomorrowAt10Iso` and
  `nextWeekMondayAt10Iso` are exported for tests that want to compare
  directly.
- **New** `apps/web/test/deferPresets.test.ts` — 17 tests: ladder starts
  with `no-timer → 5m → 15m → 30m → 1h`; long presets survive the
  reshuffle; labels are stable (`5 minutes` / `15 minutes` / `1 hour`);
  each relative preset maps to the exact delta (`5m→300s`, `15m→900s`,
  `30m→1800s`, `1h→3600s`, `2h→7200s`); `no-timer` → `null`;
  `tomorrow-10am` and `next-week` produce strictly-later timestamps
  matching their helper output; `custom` trims whitespace, empty custom
  collapses to `null`.
- **Edited** `apps/web/src/screens/Questions.tsx`:
  - `DeferDialogState.duration` now typed as `DeferPresetKey` (from the
    lib), which added `5m`, `15m`, `1h` to the union.
  - Deleted the in-file `deferKeyToIso` / `isoNowPlus` /
    `tomorrowAt10Iso` / `nextWeekMondayAt10Iso` — single source of truth
    now lives in `lib/deferPresets.ts`.
  - `submitDefer()` calls `resolveDeferPreset(dialog.duration,
    dialog.customIso, new Date())`.
  - The dialog's button grid renders from `DEFER_PRESET_ORDER.map(…)`
    instead of an inline array literal — the tests can then pin the
    ordering.

## Gates (worktree)

- `apps/web/node_modules/.bin/tsc -p apps/web --noEmit` — clean.
- `bun test apps/web/test` — 81 pass / 0 fail (17 new for defer presets).
- `bun run --filter='@gosleep/web' build` — 949 kB bundle (unchanged
  shape).

## Live-fire proof

Scratch `apps/core` booted on port 7348 (same hermetic setup as GSL-371).
Reused the seeded `q-gsl370-live-001` row after resetting it to the `open`
state. Opened the Defer dialog and confirmed the button grid renders:
`No timer / 5 minutes / 15 minutes / 30 minutes / 1 hour / 2 hours /
Tomorrow 10:00 / Next Monday 10:00 / Custom ISO`
(`assets/GSL-372/01-defer-dialog-short-presets.png`).

Clicked `5 minutes`, then `Defer`. Scratch DB after the submit:

```
qid=q-gsl370-live-001  status=deferred
                       defer_until=2026-08-16T19:09:08.245Z
```

Click timestamp: `2026-08-16T19:04:08Z`. Delta = **exactly 5 minutes
(300 s)** — the resolver honoured the preset. The panel's live countdown
shows `reopens in 4m 38s (2026-08-16T19:09:08.245Z)`
(`assets/GSL-372/02-deferred-5min-countdown.png`). Event:
`seq=3 ts=2026-08-16T19:04:08Z actor=owner-web type=question.deferred`.

Teardown: core PID killed cleanly, ports 7348 / 9246 free after run.
