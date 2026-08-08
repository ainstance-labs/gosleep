# GSL-293 [Web][Design] UI font weights capped at 500

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-265 (SPA baseline), GSL-289 (Overview KpiTile — already 500 by
this ticket's convention when I added the RunwayTile).

## Part 1 — the story

`docs/reports/web-harness-research-2026-08-03/design-system.md` §5 last sentence pins
the rule: "Владелец в текущей системе принял правило «максимум 500» для UI. …в
UI-компонентах веб-приложения по-прежнему потолок 500." 600 and 700 remain available
for HTML reports and printable documents, but NOT for the web UI.

The verifier audit found five UI surfaces at `font-semibold` (600):
- `apps/web/src/screens/Fleet.tsx` — CardTitle in the fleet cards.
- `apps/web/src/screens/Cost.tsx` — three big-number KPI values.
- `apps/web/src/components/PageHeader.tsx` — the H1 on every screen.
- `apps/web/src/components/AppShell.tsx` — the "gosleep" wordmark in the sidebar.
- `apps/web/src/theme/globals.css` — the h1..h6 base rule set the ceiling at 600.

All six changed. Every `font-semibold` in `apps/web/src/**` → `font-medium`; the CSS
h1..h6 rule now `font-weight: 500` with a comment naming the design-system section.

Non-UI files were NOT touched:
- HTML reports under `docs/reports/**` legitimately go 600+ for print headings.
- The chronicler-generated `docs/lab/site/*.html` is Phase 5 archive, frozen.

## Part 2 — the reference

- **Commit:** GSL-293 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/web/src/screens/Fleet.tsx` — semibold → medium (CardTitle).
  - `apps/web/src/screens/Cost.tsx` — semibold → medium (3× KPI values).
  - `apps/web/src/components/PageHeader.tsx` — semibold → medium (H1).
  - `apps/web/src/components/AppShell.tsx` — semibold → medium (sidebar wordmark).
  - `apps/web/src/theme/globals.css` — h1..h6 font-weight: 600 → 500, comment cites
    the design-system rule.
  - `apps/web/dist/**` rebuilt (baked into the SPA served by core at `/`).
- **Verified by running:**
  - `bun x tsc -p apps/web --noEmit` → clean.
  - `bun run --filter='@gosleep/web' build` → 2.46 s, no CSS/JS warnings.
  - `bash tools/lab/tests/core-smoke.sh` → 88 pass (SPA still serves).
  - `grep -rEn "font-semibold|font-bold|font-black|fontWeight.*[67]00" apps/web/src/` → **0 matches**.
  - `grep -n "font-weight" apps/web/src/theme/globals.css` → the only rules are
    `font-weight: 500;` (h1..h6) and `font-weight: 500;` (b/strong).
- **Links:** Jira [GSL-293](https://ainstance-labs.atlassian.net/browse/GSL-293),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
