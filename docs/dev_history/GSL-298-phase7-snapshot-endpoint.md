# GSL-298 [Core][Web] POST /actions/snapshot + Overview snapshot button

**Date:** 2026-08-09 (shift 76 / epic GSL-297 kick-off).
**Branch:** `GSL-297-web-feature-complete`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-268 (write-action envelope), GSL-261 (`apps/core/scripts/snapshot.sh`).

## Part 1 — the story

The PRD "Acceptance criteria + end-check" section names five owner-visible actions the
Phase 7 web panel must demonstrate. Four of them landed in earlier tickets (Run tick,
answer a question, apply a manifest rule, defer). The last one — "takes a manual
snapshot through a button" — was still missing on `main @ 56f57d1`: the backend script
`apps/core/scripts/snapshot.sh` existed and the launchd cron ran it at 04:00 local, but
nothing wired the script to an HTTP endpoint and nothing wired an HTTP endpoint to the
Overview screen. This task closes that gap.

New `POST /actions/snapshot` in `apps/core/src/routes/actions.ts` follows the same
envelope every other write action uses (Bearer + Origin + Idempotency-Key + `serialize`
+ `withTimeline`). It spawns `snapshot.sh` synchronously via `spawnAwait` (bounded at
20 s — a warm `sqlite3 .backup` is normally <200 ms), parses the last
`{"event":"core.snapshot.ok",…}` JSON line from stdout to lift `kind` + `path` into the
response body, and returns a typed result. Owner-clicked snapshots default to
`--kind manual --label owner-web` so the file lands as
`data/snapshots/manual-owner-web-<ts>.db` and is retained indefinitely per snapshot.sh's
retention rule (the launchd cron still owns the `daily-*.db` slot with its own 30-day
prune).

TouchID intentionally stays out of this write path — the blast radius is a file under
`data/snapshots/`, never the primary DB (gap-analysis Gap 1 blast section). Bearer +
Origin is the sole guard, matching every other low-blast write.

**Bug found and fixed in the same commit.** The very first smoke run exposed a latent
bug in `snapshot.sh`: on an empty snapshots directory (fresh install / smoke's scratch
tree), the two `prune_keep_last` calls hit an empty pipe, the trailing `while read`
returns exit 1, `set -o pipefail` propagates it, and the script exits with rc=1 even
though the `.backup` itself succeeded. The launchd cron never noticed because its
snapshots dir is never empty in production; the new endpoint noticed immediately. Fix:
add `|| true` to the `prune_keep_last` function body and an explicit `exit 0` at the
end of the script, matching the header contract ("Retention failures WARN and continue —
a full disk should never eat the primary DB"). The header comment already promised
non-fatal retention; the implementation now matches.

**Env pass-through gotcha.** `spawnAwait` intentionally sanitises the child env — only
`GOSLEEP_LAB_DIR` + `GOSLEEP_RUN_ID` auto-forward. Without an explicit forward of
`GOSLEEP_DB_PATH`, the smoke's scratch-DB scenarios would snapshot the real
`data/gosleep.db` (the wrong file) instead of the scratch DB. `doSnapshot` now forwards
`GOSLEEP_DB_PATH` explicitly. The smoke's new scenario 69b asserts the returned path is
inside the scratch tree — this catches the regression if the env pass-through is ever
removed.

**Jira description note.** The Jira description (echoing a stale line in `CLAUDE.md`)
promised the file layout as `data/snapshots/YYYY-MM-DD/gosleep.db + status.json`. The
shipped `snapshot.sh` writes flat `data/snapshots/<kind>-<ts>.db` — no date subdir, no
`status.json`. The endpoint honours the ACTUAL shipped script layout (verified in
scenario 69b). No status.json file is written; the launchd-cron shape and the
manual-button shape are now uniform. If the owner still wants the `YYYY-MM-DD/`
subdirectory grouping + a status.json sidecar, that is a separate follow-up in the
snapshot subsystem, not this thin-wiring task.

## Part 2 — the reference

- **Commit:** `GSL-298 …` — one commit on `GSL-297-web-feature-complete`.
- **Files:**
  - `apps/core/src/routes/actions.ts` — new `doSnapshot` + `POST /actions/snapshot`
    route. Header comment bumped from "seven v1 write endpoints" to "eight". Includes
    label-sanity guard (`[A-Za-z0-9._-]{1,64}`) so the label cannot escape the
    filename.
  - `apps/core/scripts/snapshot.sh` — `|| true` on `prune_keep_last`'s while pipe and
    an explicit `exit 0` at the tail so the script's exit code represents the backup,
    not the retention.
  - `packages/schema/src/index.ts` — new `SnapshotActionInput` / `SnapshotActionResult`
    / `SnapshotActionResponse` zod schemas (`label` optional, matches the endpoint
    regex). Reuses the shared `LabToolTrace` + `actionResponse` helpers.
  - `packages/sdk/src/index.ts` — new `takeSnapshot(input, idempotencyKey)` method on
    `CoreClient`, plus the type imports/exports for `SnapshotActionInput/Response`.
  - `apps/web/src/data/queries.ts` — new `useTakeSnapshot()` mutation hook. On success
    invalidates `["core", "status"]` + `["core", "timeline"]` so the Live pulse tile
    refreshes without waiting for the SSE round-trip.
  - `apps/web/src/screens/Overview.tsx` — "Snapshot" button next to the "Run tick"
    button in the page header (ghost variant so the primary CTA stays "Run tick"),
    confirm dialog that mirrors the tick dialog, success toast that surfaces the
    returned snapshot path so the operator can `open $(dirname …)`.
  - `tools/lab/tests/core-smoke.sh` — new scenarios 67-71:
    67 (no auth → 401), 68 (bad label → 400), 69 (valid → 200 + `kind=manual`) + 69b
    (path exists on disk under the scratch tree), 70 (replay same
    Idempotency-Key → `cached:true`), 71 (no label → 200 + `kind=daily`).
- **Verified by running:**
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bun x tsc -p apps/web --noEmit` → clean.
  - `bun test` in `apps/core` → **191 pass, 0 fail** (unchanged; unit tests do not
    exercise the new endpoint — smoke covers it end-to-end).
  - `bun run --filter='@gosleep/web' build` → 2.74 s, clean.
  - `bash tools/lab/tests/core-smoke.sh` → **95 pass, 0 fail** (was 90; +5 for the new
    scenarios, +0 regressions).
- **Live-endpoint proof (from the smoke on this box):** `POST /actions/snapshot` with
  `{"label":"smoke"}` returned 200 with
  `result.path = /Users/…/.artifacts/core-smoke/snapshots/manual-smoke-2026-08-09T20-05-39Z.db`
  and the file exists at that path (`ls -la` confirmed via scenario 69b). Replay with
  the same Idempotency-Key returned `cached:true`. No-label call returned
  `kind=daily`.
- **Links:** Jira [GSL-298](https://ainstance-labs.atlassian.net/browse/GSL-298),
  parent epic [GSL-297](https://ainstance-labs.atlassian.net/browse/GSL-297), gap
  reference `docs/reports/web-feature-complete-2026-08-09/gap-analysis.md` Gap 1.
