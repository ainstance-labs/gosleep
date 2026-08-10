# GSL-287 (follow-up) — Skills screen live browser check + m2 code comment

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Follow-up to GSL-287 (already Done — tonight's Skills screen build) addressing verifier
`GSL-174-night/runs/01/index.html` punch-list item 1 ("Skills screen must be loaded live in
the browser — the tonight-build skipped this step") and minor finding m2 (the two-part change
needed when TouchID lifts, out of scope tonight — just a code comment).

## What landed

- **`apps/web/src/screens/Skills.tsx`** — one-line-block code comment above the disabled
  Publish button naming the two-part change needed when the TouchID pause lifts (drop
  `disabled` + wire `onClick={() => submitPublish(row)}`), with an explicit reference to
  owner decision `d-2026-08-09-001`, GSL-266 (the button wiring task), and GSL-288 (the
  TouchID gate task) so both must land in a single commit. No behavior change — the button
  stays disabled, the tooltip stays present, the mutation hook stays wired.
- **`docs/reports/verifications/GSL-174-night/runs/01/assets/`** — four screenshots + one
  evidence markdown, all captured against a scratch core on `127.0.0.1:7332` with a scratch
  DB under `.artifacts/finish-174/`. Production (`data/gosleep.db`, port `7331`) not touched.
  - `skills-screen-light.png` — Skills route, light mode. All 6 visible cards render, "5 skills
    with changes" badge, TouchID-paused notice citing `d-2026-08-09-001`, every Publish
    button reads "Publish (paused)" in the visibly-disabled state.
  - `skills-screen-dark.png` — same page under `prefers-color-scheme: dark` (via CDP
    `Emulation.setEmulatedMedia`).
  - `spa-overview-light.png` / `spa-overview-dark.png` — Overview screen from the same
    session; SKILLS tile shows `7` (all seven skills counted through the /skills endpoint via
    the SDK), owner + version footer live from `/version` + `/whoami`.
  - `skills-screen-live-check.md` — evidence file (repro steps, environment, results).

## Console + network signal

Captured via Chrome DevTools Protocol (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`,
`Log.entryAdded`, `Network.responseReceived` for ≥400, `Network.loadingFailed`):
`{"console_events":0,"network_failures":0}` for the full flow (load → auth via `?token=` lane
→ click Skills nav → render list → data load).

## Method note (why CDP, not `chrome --screenshot`)

The Skills route `/skills` is an API endpoint (returns 401 without Bearer). Direct navigation
lands on the JSON handler, not the SPA route. Reaching the Skills SPA route requires
client-side react-router navigation from within the loaded SPA. `chrome --headless
--virtual-time-budget=...` timed out repeatedly on the navigate-then-click pattern; a small
Bun CDP client (`.artifacts/finish-174/cdp-screenshot.ts`, ~60 lines, not committed) drove
`Page.navigate` + `Runtime.evaluate` (`document.querySelector('a[href="/skills"]').click()`)
+ `Page.captureScreenshot` deterministically.

## Gates run before commit

- `apps/web/node_modules/.bin/tsc -p apps/web --noEmit` — clean (the comment change).
- `bun test` — 228 pass / 0 fail (unchanged from tonight's baseline).
- `bun run --filter='@gosleep/web' build` — 2.51 s, no warnings besides the pre-existing
  chunk-size warning.
- Chrome CDP console/network capture — 0/0 during the live check.

## Notes

- **Autonomous decision (night session d-2026-08-09-005).** Chose the CDP path after
  `chrome --headless --screenshot` proved unreliable for post-navigation captures — the
  virtual-time-budget expired before the client-side route change flushed. The CDP path
  costs ~60 lines of throw-away Bun WebSocket code; it lives under `.artifacts/finish-174/`
  and does not enter the repo.
- **`GOSLEEP_SKILLS_BACKUPS_DIR`, `GOSLEEP_CHANGELOG_PATH`, `GOSLEEP_DB_PATH`, `GOSLEEP_LAB_DIR`,
  `GOSLEEP_CORE_PORT`, `GOSLEEP_BEARER_TOKEN`, `GOSLEEP_OWNER_NAME`, `GOSLEEP_DISABLE_JIRA_SYNC`
  = hermetic-test knobs used.** No production side effects. Scratch core torn down at end
  of run.
- **m2 stays paused.** Per mission scope, the TouchID-gated enable path is owner-gated; this
  shift just documents the two-part change in code so an implementer cannot miss it when
  the pause lifts.
