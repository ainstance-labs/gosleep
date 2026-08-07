# GSL-283 — Deprecation banner on the 2026-08-03 research index (phase 7)

**Branch:** `GSL-250-control-plane` · **Commit:** see git log · **Shift:** 75 (cycle 208, impl-web-11)

`docs/reports/web-harness-research-2026-08-03/index.html` was the 2026-08-03 research dashboard
that recommended **variant A** (Node + Hono over the existing static pipeline). Owner decision
`d-2026-08-03-004` on the same day rejected that recommendation in favour of the Warren-model
architecture (Bun + Hono core + React SPA). Every reviewer opening the page since — and every
future one — read the stale "Рекомендуем" tag as still authoritative.

## What changed

* **Top-of-page deprecation banner** (right after `<body>`, before `<header>`, sticky). Inline-
  styled so it renders even when the site stylesheet is bypassed (GitHub's Markdown viewer
  strips `<link>` refs above the fold; a CSS-classed banner would disappear there). English
  per the ticket. Points to `target-architecture.md` + `target-architecture-rev3-addendum.md`.
* **Inline note at the head of the "Три варианта" section** (approx line 1032). Small aside
  with the same target-file pointers, so a reviewer who deep-links straight to that section
  still sees the correction.
* **`grep -c "Superseded" index.html` = 3** (banner strong + banner body + inline aside header).
  Meets the ticket acceptance criterion `≥ 2`.
* **NOT regenerated** — the historical narrative below the banner is preserved verbatim as
  the ticket asked.

## Also inside this commit (small [Docs] fix)

* Renamed dev-history files carrying a `phase37` typo (should have been `phase7`):
  * `GSL-276-phase37-fleet-agent-sessions.md` → `GSL-276-phase7-fleet-agent-sessions.md`
  * `GSL-277-phase37-manifest-provenance.md` → `GSL-277-phase7-manifest-provenance.md`
  * `GSL-278-phase37-defer-action.md` → `GSL-278-phase7-defer-action.md`
  * The PRD (`docs/prd/01-phase7-interactive-control-plane.md`) is authoritative: the web
    control plane is phase 7 of the roadmap, not phase 37. The typo crept in with GSL-276.

## Live proof

* `grep -c "Superseded" docs/reports/web-harness-research-2026-08-03/index.html` prints `3`.
* Opening the page in a browser shows the red banner sticky above the fold; scrolling to
  section 3 shows the inline aside above the variant cards.
* Repo `smoke.sh`: **551/0** (unchanged — this is a docs-only commit).
* `gate.sh --offline`: green.
