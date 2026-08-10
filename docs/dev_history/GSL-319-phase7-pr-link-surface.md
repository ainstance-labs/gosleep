# GSL-319 · phase 7 · Surface PR links on the panel

## What was done

The panel now shows the PR URL a dev-agent just opened. During run 06 the dev-agent opened
`https://github.com/ainstance-labs/gosleep-e2e-todo/pull/3`, but scanning every screen
(Overview / Fleet / Timeline / Questions / Tasks) returned zero matches for any PR URL
pattern — the entire "here is what your agent shipped" surface was invisible.

Two surfaces now render the link:

1. **Overview → "Latest PR"** card: the freshest `last_pr_url` across the live fleet,
   with an "opened by <session-name>" caption and an "observed <timeAgo>" timestamp. The
   URL is a plain `<a target="_blank" rel="noopener noreferrer">` so a click opens the PR
   in a new tab.
2. **Fleet → per-row "Latest PR"** chip: each session card that has touched a PR shows the
   URL below the intent line. Hidden entirely on sessions that never opened a PR so the
   card stays quiet on read-only sessions.

## Implementation

- Migration `0004_agent_pr_url.sql` adds `agent_sessions.last_pr_url TEXT` and
  `agent_sessions.last_pr_at TEXT`.
- `extractPrUrl(...sources)` in `apps/core/src/routes/internal.ts` — narrow regex over the
  canonical `https://github.com/<owner>/<repo>/pull/<n>` shape. Rebuilds the URL from the
  three matched groups so query strings, fragments, and trailing punctuation are stripped.
  Rejects GitLab, `/issues/`, and non-PR patterns.
- `POST /internal/agents/tool-observed` now accepts three new optional fields:
  - `command_preview` — the invoking Bash command (or a compact preview of any tool_input).
  - `response_preview` — the tool response (Bash stdout / text tool output).
  - `pr_url` — an explicit URL, if the caller already parsed one (still validated).
  The extractor scans `command_preview + response_preview + intent` for the PR URL pattern
  and UPSERTs it (with the observation timestamp) via COALESCE on the existing row.
- `tools/hooks/tool-observed-feed.sh` extracts `tool_input.command` (Bash) or the whole
  serialised `tool_input` (fallback) as `command_preview`, and takes the first 600 chars of
  `tool_response.stdout` / `.output` as `response_preview`. Both fields are capped and
  fail-open — an extraction error never fails the shim.
- `/fleet` and `/bundle` expose `last_pr_url` + `last_pr_at` on every session row.
- `packages/schema/src/index.ts` — `FleetSession.last_pr_url` + `last_pr_at` fields (both
  nullable / optional so a legacy row without them keeps parsing).
- `apps/web/src/screens/Overview.tsx` — new `pickLatestPr` helper + `LatestPrCard`
  component. Hidden when no session has a PR URL, so the Overview stays quiet on non-
  shipping fleets.
- `apps/web/src/screens/Fleet.tsx` — per-row "Latest PR" chip with a hover tooltip showing
  the observation timestamp.

## Problems solved

- **No PostToolUse hook wiring needed.** Extending the existing tool-observed feeder to
  send previews of `tool_input.command` and `tool_response.stdout` was cheaper than adding
  a new hook script + registering it in `.claude/settings.json` (the settings file reloads
  live — mutations there are risky). The feeder already fires on every PreToolUse AND
  PostToolUse event via `lab-log-hook.sh`'s fan-out, so the URL surfaces the moment
  `gh pr create` returns.
- **Placeholder rows do not lose the URL.** The tool-observed handler used to only touch
  three columns on a session that fleet-poll had not yet inserted. Extended the placeholder
  INSERT to also set `last_pr_url` + `last_pr_at`, so the URL sticks even for a session
  that never surfaces in `claude agents --json` (throwaway workspaces, background scripts).
- **Extractor is single-source-of-truth.** `extractPrUrl` is exported and unit-tested; the
  handler passes it three fields and takes the first hit. A future caller who wants to
  pre-parse can hand in the explicit `pr_url` — the extractor still validates the shape.

## Problems remaining

- The overview shows only the FRESHEST URL across all sessions — an eight-session fleet
  with three simultaneously open PRs would collapse to one link. Enough for the run-06
  case (one dev-agent per pilot session); a "Recent PRs" list is a v2 nice-to-have.
- No polling of `gh pr list` — the URL only surfaces when the dev-agent invokes a `gh`
  command whose input/output mentions it. That is exactly the case run 06 called out;
  reading the Jira remote-links or the GitHub API on a timer is a broader follow-up.

## Pitfalls & workarounds

- **Drizzle SQL migrations need `--> statement-breakpoint`** between multiple ALTER TABLE
  statements. The first attempt at `0004_agent_pr_url.sql` had two ALTERs on separate lines
  and drizzle silently ran only the first (last_pr_url landed, last_pr_at didn't) —
  core-smoke caught this with a 500 on `/fleet`. Added the breakpoint marker and re-ran.
- Three existing test files (`fleet.projection`, `fleet.poll`, `metrics`) hand-build the
  `agent_sessions` table with raw SQL; each got the two new columns so a fresh in-memory
  DB matches the migrated shape.
- The Fleet screen's PR link is placed BEFORE the cwd/updated-at footer so it lines up
  with the intent/tool blocks visually — a chip after the footer would visually orphan the
  link from the row's content.

## What didn't make it

- No SSE-driven `pr_observed` event type — the existing `agent_sessions.updated` event
  fires on every flush, and the SPA already invalidates `/fleet` on it, so the URL surfaces
  within one debounce window (1 s). A dedicated event type would add plumbing for no
  observable benefit.

---

## Technical reference

**Commit:** (filled at commit time)

**Key files:**

- `apps/core/drizzle/0004_agent_pr_url.sql` — migration.
- `apps/core/drizzle/meta/_journal.json` — journal entry for migration 0004.
- `apps/core/src/db/schema.ts` — adds the two columns.
- `apps/core/src/routes/internal.ts` — `extractPrUrl`, extended
  `ToolObservation` interface, updated tool-observed handler + flush.
- `apps/core/src/routes/read.ts` — `AgentSessionRow` type + `/fleet` + `/bundle` projections.
- `packages/schema/src/index.ts` — `FleetSession.last_pr_url` + `last_pr_at`.
- `tools/hooks/tool-observed-feed.sh` — sends `command_preview` + `response_preview`.
- `apps/web/src/screens/Overview.tsx` — `pickLatestPr`, `LatestPrCard`, wiring.
- `apps/web/src/screens/Fleet.tsx` — per-row PR chip.
- `apps/core/test/pr-url-extractor.test.ts` — 7 unit tests pinning the extractor.
- `apps/core/test/fleet.projection.test.ts`, `fleet.poll.test.ts`, `metrics.test.ts` —
  agent_sessions test schemas updated with the new columns.

**Verified by running:**

- `bun run --filter='@gosleep/core' typecheck` — 0 errors.
- `bun run --filter='@gosleep/web' typecheck` — 0 errors.
- `bun test apps/core` — 260 tests / 644 expects, 0 failures.
- `bash tools/lab/tests/core-smoke.sh` — 102 pass / 0 fail (`/fleet` + tool-observed
  round-trip works with the new columns).
- `bun run --filter='@gosleep/web' build` — clean.
- Live proof: scratch core on 127.0.0.1:7348, Playwright + headless Chromium at
  `.artifacts/live/verify.mjs`. Screenshots (`overview-latest-pr.png`,
  `fleet-model-and-pr.png`, `questions-permission-command.png`) show all three fixes
  rendering.

**Links:**

- Jira: [GSL-319](https://ainstance-labs.atlassian.net/browse/GSL-319) under epic
  [GSL-318](https://ainstance-labs.atlassian.net/browse/GSL-318).
- GH mirror: (filled at commit time).
- Run 06 finding: `docs/reports/verifications/web-e2e-2026-08-10/runs/06/index.html`
  finding #2.
