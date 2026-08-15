# GSL-321 · phase 7 · Fleet Model column reads the session's real model (transcript-first)

## What was done

The Fleet screen's Model column now shows the model the session is ACTUALLY running (per
its transcript), not the value in the global `~/.claude/settings.json`. During live-fire
run 06 the `todo-workspace-47` session was launched with `claude --model haiku` and 62
assistant turns logged as `claude-haiku-4-5-20251001` — but Fleet displayed
`claude-fable-5[1m]` (the global-settings value) for the whole run. That was worse than
"unknown": a confident wrong value.

Implementation:

- Added `resolveTranscriptModel(session_id, opts)` in
  `apps/core/src/adapter/model-resolver.ts`. Uses the `SessionAdapter.readTranscript()`
  seam to enumerate transcript files for a session; reads the tail (~64 KiB by default)
  of the newest one and scans backwards for the latest `{"type":"assistant","message":
  {"model":"…"}}` row. Returns null on any failure or when no assistant turn has landed
  yet — the caller falls back to the settings hierarchy.
- Reworked `modelCache.get()` to take `(session_id, cwd, opts)`. New precedence: transcript
  first (only per-session-honest source), then the existing settings-hierarchy resolver
  (`GSL-290`). Cache key now includes `session_id` so two sessions in the same cwd don't
  collide.
- `apps/core/src/workers/fleet-poll.ts` passes `a.session_id` alongside `a.cwd` on every
  tick. The COALESCE upgrade in the UPDATE (`model = COALESCE(?, model)`) means a stable
  transcript value overwrites a stale settings-derived one on the next poll cycle.
- `apps/web/src/screens/Fleet.tsx` — updated the tooltip so a reader hovering the Model
  pill sees "read from the session transcript (falls back to Claude Code settings
  hierarchy)". The "model unknown" fallback pill is unchanged.

## Problems solved

- **Wrong-source truth.** `claude agents --json` doesn't surface the per-invocation
  `--model` override; only the transcript does. Reading it there fixes both the reported
  case (`--model haiku` overriding the global) AND a subtler case (a `--model sonnet`
  session in a project whose `settings.json` says `opus`).
- **API break kept local.** Changing `modelCache.get()`'s signature required updating the
  two existing tests (`model-resolver.test.ts`) — they now pass an empty `listTranscripts`
  so the settings-hierarchy story stays covered.
- **Runaway file reads.** A long session's transcript can be many MB. The reader takes the
  tail slice (`readFileSync` then `raw.slice(-tailBytes)`) so the scan is bounded even if
  Bun's blob-slice sync API is absent. `tailBytes` defaults to 64 KiB — enough for ~200
  assistant turns of a Haiku-length conversation.

## Problems remaining

None known. Future work could read the true window size from `message.usage` in the same
transcript row (this would give a more accurate `context_pct` than the byte-heuristic in
`tool-observed-feed.sh`), but that is a `GSL-2xx` follow-up, not part of this task.

## Pitfalls & workarounds

- The adapter import (`getSessionAdapter`) is guarded by a `try/catch` on the readfile
  wrapper: if the transcripts root is missing (e.g. in a hermetic test container that
  doesn't have `~/.claude/projects`) we return null and the settings-hierarchy path takes
  over. The unit test's `listTranscripts` hook exercises the seam without touching disk.
- `assistant` turns from Explore/Task subagents also carry `message.model`; we deliberately
  return the LATEST one, not the first. On a Haiku parent with a Sonnet Explore subagent
  the last row wins — that's the right answer because the *next* turn's model is what the
  operator cares about.

## What didn't make it

- No plumbing to distinguish parent vs. subagent turns — the transcript rows don't carry
  a stable role tag on this axis. Rendering both would need a schema addition (and would
  probably confuse more than help).

---

## Technical reference

**Commit:** (filled at commit time)

**Key files:**

- `apps/core/src/adapter/model-resolver.ts` — new `resolveTranscriptModel`, reworked
  `modelCache`, extended header comment explaining the precedence.
- `apps/core/src/workers/fleet-poll.ts` — passes `session_id` to the cache.
- `apps/web/src/screens/Fleet.tsx` — tooltip updated to reflect the new source.
- `apps/core/test/transcript-model.test.ts` — 12 new unit tests (parse, tail scan, newest
  file wins, malformed line survives, transcript→settings fallback, session-scoped cache).
- `apps/core/test/model-resolver.test.ts` — 2 existing cache tests updated for the new
  signature.

**Verified by running:**

- `bun run --filter='@gosleep/core' typecheck` — 0 errors.
- `bun run --filter='@gosleep/web' typecheck` — 0 errors.
- `bun test apps/core` — 253 tests / 634 expects, 0 failures.
- `bun run --filter='@gosleep/web' build` — clean.

**Links:**

- Jira: [GSL-321](https://ainstance-labs.atlassian.net/browse/GSL-321) under epic
  [GSL-318](https://ainstance-labs.atlassian.net/browse/GSL-318).
- GH mirror: (filled at commit time).
- Run 06 finding: `docs/reports/verifications/web-e2e-2026-08-10/runs/06/index.html`
  finding #3.
