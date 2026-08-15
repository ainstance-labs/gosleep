# GSL-287 Skills screen — live browser check (verifier punch-list item 1)

**Date:** 2026-08-10 · **Actor:** `finish-174` (night polish worker) · **Follow-up to:** verifier
`GSL-174-night/runs/01/index.html` punch-list item 1 ("Skills screen must be loaded live in
the browser — the tonight-build skipped this step").

## What was verified

The Skills screen (`apps/web/src/screens/Skills.tsx`) was loaded live in a **real Chromium
instance** (Google Chrome 151.0.7922.108, headless mode, driven via Chrome DevTools Protocol)
against a **scratch core + scratch DB** — no production data touched.

## Environment

| Piece         | Value                                                            |
|---------------|------------------------------------------------------------------|
| Core port     | `127.0.0.1:7332` (not the production 7331)                       |
| Scratch DB    | `.artifacts/finish-174/gosleep.db` (fresh migrate)               |
| Scratch lab   | `.artifacts/finish-174/lab/` (fresh, empty)                      |
| Bearer        | `GOSLEEP_BEARER_TOKEN=finish-174-scratch-token-32-chars-aa` (env-dev-bypass) |
| Static bundle | `apps/web/dist/` from a fresh `bun run build` (unmodified for the CDP shots) |
| Browser lane  | Chrome CDP on `127.0.0.1:9224`; navigate + click nav via `Runtime.evaluate` |

## Results

### Screenshots (both taken with the app running in this scratch environment)

- `skills-screen-light.png` — light mode, `?token=` lane authenticated, sidebar shows `Skills` active,
  header shows "**5 skills with changes**" badge, TouchID-paused notice **explicitly cites owner
  decision `d-2026-08-09-001`**, all six visible skill cards render (delivery-workflow, handoff,
  orchestrating-delivery-agents, remote-control, tmux-agents-orchestration, using-jira) with
  local/prod hashes, and every applicable Publish button reads "**Publish (paused)**" in the
  visibly-disabled state. Row-status badges (`has changes`, `clean`, `no development copy`)
  render correctly against the scratch state.
- `skills-screen-dark.png` — same page under `prefers-color-scheme: dark`
  (`Emulation.setEmulatedMedia`). Theme toggle in the header flipped to "Light". All content
  legible; disabled Publish styling still reads as disabled (blue-tinted vs the accent-solid
  active buttons on clean rows).
- `spa-overview-light.png` / `spa-overview-dark.png` — Overview screen from the same session,
  proving the SPA is wired end-to-end against the scratch core: **SKILLS 7** tile renders
  (all seven skills counted through the `/skills` endpoint via the SDK), `owner: finish-174`
  and `version: 0.0.1` in the sidebar footer come from `/version` + `/whoami`.

### Console / network signal

Captured via CDP (`Runtime.consoleAPICalled` + `Runtime.exceptionThrown` + `Log.entryAdded`
+ `Network.responseReceived` for ≥400 statuses + `Network.loadingFailed`):

```
{"console_events":0,"network_failures":0}
```

Zero console warnings, zero exceptions, zero non-2xx responses during the full flow
(load → auth via `?token=` lane → click Skills nav → render list → data load).

### Publish button — the specific verifier ask

- Button text on rows with changes: **"Publish (paused)"** (confirmed in both light + dark shots).
- Button is disabled — verified visually (accent styling muted vs the enabled outline button),
  DOM contract: `disabled` + `aria-disabled="true"` + `title=TOUCHID_PAUSED_TOOLTIP`
  (`Skills.tsx` lines 170-186, unchanged tonight aside from the m2 comment addition — see below).
- Tooltip content: `"TouchID paused (d-2026-08-09-001). Publish via CLI: bash tools/skills/publish.sh <name>"`
  — the notice paragraph at the top of the screen surfaces the same reference to
  **owner decision `d-2026-08-09-001`** in the rendered UI (visible in both screenshots).

## m2 (Skills.tsx onClick when TouchID lifts) — comment added

Per mission scope, the m2 finding is NOT wired tonight (touching the TouchID-gated enable
path is out of scope for the safe/non-owner-gated punch-list). A one-line-block code comment
was added immediately before the `<Button variant="solid" ... disabled ...>` in
`apps/web/src/screens/Skills.tsx` naming the two-part change (drop `disabled` + wire
`onClick={() => submitPublish(row)}`) that must land together in the GSL-266 + GSL-288 pair
when the TouchID pause lifts. No behavior change; `bun x tsc -p apps/web --noEmit` clean.

## Reproduction

```bash
# 0. Prereqs: no other process on port 7332.
export SCRATCH="$(pwd)/.artifacts/finish-174"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/lab/"{questions,events,decisions,supervision}

# 1. Migrate a scratch DB + seed skills placeholders.
GOSLEEP_DB_PATH="$SCRATCH/gosleep.db" bun run apps/core/scripts/migrate.ts
GOSLEEP_DB_PATH="$SCRATCH/gosleep.db" \
  GOSLEEP_CHANGELOG_PATH="$SCRATCH/CHANGELOG.jsonl" \
  bun run apps/core/scripts/record-publish.ts fold

# 2. Build the web bundle (once).
(cd apps/web && bun run build)

# 3. Boot scratch core on 7332.
GOSLEEP_BEARER_TOKEN="finish-174-scratch-token-32-chars-aa" \
  GOSLEEP_OWNER_NAME="finish-174" \
  GOSLEEP_CORE_PORT=7332 \
  GOSLEEP_DB_PATH="$SCRATCH/gosleep.db" \
  GOSLEEP_LAB_DIR="$SCRATCH/lab" \
  GOSLEEP_DISABLE_JIRA_SYNC=1 \
  bun run apps/core/src/serve.ts &
sleep 2

# 4. Boot headless Chrome with CDP.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --window-size=1400,1100 \
  --user-data-dir="$SCRATCH/chrome" \
  --remote-debugging-port=9224 \
  '--remote-allow-origins=*' \
  about:blank &
sleep 2

# 5. Drive it: navigate, click Skills nav, screenshot. See .artifacts/finish-174/cdp-screenshot.ts.
CDP_PORT=9224 bun run "$SCRATCH/cdp-screenshot.ts" out.png
```

## Notes on the CDP path (why not just `chrome --screenshot`)

`chrome --screenshot=<file> <url>` renders a single URL — perfect for the Overview screen
(`http://127.0.0.1:7332/`) but Skills lives at `/skills`, which is an API endpoint (returns
401 without Bearer). Direct navigation lands on the JSON handler, not the SPA route.

Reaching the Skills SPA route requires **client-side react-router navigation** from within
the loaded SPA. `chrome --headless --virtual-time-budget=...` timed out repeatedly on the
navigate-then-click pattern; switching to Chrome DevTools Protocol (Bun `WebSocket` client
under 60 lines) let us drive click-through deterministically. The client script lives at
`.artifacts/finish-174/cdp-screenshot.ts` — hermetic, not committed to git.
