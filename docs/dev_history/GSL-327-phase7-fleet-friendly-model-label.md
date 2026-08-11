# GSL-327 — Fleet friendly model label (mapper + fallback + sentinel pass-through)

**Epic:** GSL-326 · **Branch:** `GSL-326-cosmetic-polish` · **Base:** `origin/main` @ `394cc6e`.

## Symptom (E2E run 08 cosmetic finding)

`docs/reports/verifications/web-e2e-2026-08-10/runs/08/` flagged the Fleet
Model column as unreadable — raw Claude Code model ids leaked straight to
the UI: `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`,
`claude-haiku-4-5-20251001`. Cosmetic only (no correctness impact) but the
gap defeats the panel's "quick glance at what's running" promise.

## Fix

Pure `formatModelLabel(id)` in `apps/web/src/lib/format.ts` — colocated
with the other tiny formatters (`timeAgo`, `timeOfDay`, `hashToHue`).

Rules encoded:

- **Known families → marketing label.** `claude-opus-4-8` → `Opus 4.8`,
  `claude-fable-5` → `Fable 5`, `claude-haiku-4-5` → `Haiku 4.5`, etc.
  Prefix table ordered longest-first so future dated snapshot suffixes
  (`claude-haiku-4-5-20251001`) still hit the right family without an
  update.
- **Sentinels pass through verbatim.** `unknown` (GSL-321
  transcript-first) and `starting` (GSL-325 boot-window) are the two
  values the resolver emits when it deliberately declines to answer.
  Relabeling those would actively mislead the operator — they get left
  alone.
- **Unknown ids → graceful cleaned fallback.** Prefix `claude-` stripped,
  trailing `-YYYYMMDD` snapshot suffix stripped, TitleCased. Never
  returns an empty string or throws — an unrecognised id must still
  render something readable rather than breaking the pill.
- **Raw id on hover.** Fleet's `<span title="...">` now shows the
  underlying id so debugging stays a mouse-over away.

Wired at exactly one call-site: `apps/web/src/screens/Fleet.tsx`. Nothing
else consumes `s.model` today; the mapper lives in the shared web `lib/`
so a future consumer picks it up without a rewrite.

## Tests

`apps/web/test/formatModelLabel.test.ts` — 28 test cases:

- Every listed family maps to its marketing label (13 cases via
  `test.each`).
- Dated snapshot suffixes still resolve to their family (3 cases
  including the exact E2E-run08 case `claude-haiku-4-5-20251001`).
- Both sentinels pass through unchanged.
- Unknown ids fall back to a TitleCased cleaned label (`claude-nova-9` →
  `Nova 9`, `gpt-5-turbo` → `Gpt 5 Turbo`), never empty.
- Null-ish / whitespace-only inputs resolve to `"unknown"`.
- Prefix boundary safety (`claude-fable-5-foo` → `Fable 5`,
  `claude-fable-50` → `Fable 50` — no silent mis-labeling).

## Gates run

- `bun x tsc -p apps/web --noEmit` — clean.
- `bun x tsc -p apps/core --noEmit` — clean (unchanged).
- `bun test apps/web` — 36 pass (28 new + 8 existing).
- `bun test apps/core` — 268 pass (regression only, nothing touched
  server-side).
- `GOSLEEP_CORE_PORT=7352 bash tools/lab/tests/core-smoke.sh` — 102/102
  pass on the worktree-local scratch DB.
- `bun run --filter='@gosleep/web' build` — clean.

## Live proof

`.artifacts/live-proof/screenshots/s2-fleet-friendly-labels.png`
(copied to `docs/dev_history/assets/GSL-327/s2-fleet-friendly-labels.png`).

Playwright driver (`tools/e2e/scenarios/gsl-326/run.mjs`) hit the
worktree-local scratch core (127.0.0.1:7352) seeded with sessions in
every family:

| model id (raw)                    | rendered label |
|-----------------------------------|----------------|
| `claude-fable-5`                  | `Fable 5` × 2  |
| `claude-opus-4-7`                 | `Opus 4.7`     |
| `claude-opus-4-8`                 | `Opus 4.8` × 2 |
| `claude-sonnet-5`                 | `Sonnet 5`     |
| `claude-haiku-4-5-20251001`       | `Haiku 4.5`    |
| `claude-nova-9` (unknown family)  | `Nova 9`       |
| `unknown` (sentinel)              | `unknown`      |
| `starting` (sentinel)             | `starting`     |

Driver also asserted the negative: `page.locator("text=/^claude-fable-5$/").count()`
returned **0** — no raw id leaked to the UI.

## Files touched

- `apps/web/src/lib/format.ts` — `formatModelLabel` + `MODEL_FAMILIES`
  table + `MODEL_SENTINELS` set + `fallbackModelLabel` helper.
- `apps/web/src/screens/Fleet.tsx` — import + call-site swap; existing
  null-guard unchanged; `title` attr now prefixes the raw id.
- `apps/web/test/formatModelLabel.test.ts` — new.
