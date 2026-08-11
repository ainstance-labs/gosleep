# GSL-331 — Fleet boot-window: absent transcript for a fresh session → starting, not settings fallback

Parent epic: **GSL-330** ("Run-09 live-agent findings").
Prior related: GSL-321 (transcript-first reader), GSL-325 (`starting` state for transcript-exists-but-empty).
Landed on branch `GSL-330-run09-fixes`.

## What was done

Fleet-poll now hands the session's `started_at_epoch_ms` to `modelCache.get`. When the transcript
reader reports `absent` (no matching file on disk) AND the session is younger than a 60-second
boot-window grace, the resolver returns `null` — the Fleet card renders `unknown` instead of
the fabricated global settings default that ran-09 saw as "Fable 5[1m]" on a `--model sonnet`
session. Older sessions with a truly missing transcript still fall through to the settings
hierarchy as before, so a long-lived session that never journaled anything still gets a value.

Six new unit tests cover the four cross-product cases (young/old × with/without startedAtEpochMs),
the boundary at `bootGraceMs`, the transcript-FOUND override during the boot window, and the
negative-age clock-skew case ("safer to show unknown than to fabricate").

Delivered as one commit `GSL-331`. Live proof: `.artifacts/live-proof-major1/proof.mjs` runs
`reconcileRoster` in-process against a scratch DB with a fake `$HOME` whose `settings.json`
declares `claude-fable-5`. Two rosters (5 s old + 120 s old) run through the same tick; the
young session's row lands with `model=NULL`, the old session's row falls back to `fable-5`.

## Problems solved

- Run 09 finding #6: a delegated `claude --model sonnet` session labelled "Fable 5[1m]" for
  ~1 minute at spawn. GSL-325 handled the `starting` state (transcript exists, empty), but
  the ABSENT case (transcript file not yet on disk during the first seconds after `claude`
  starts) fell through to the settings-hierarchy resolver — the exact wrong-but-confident
  behavior GSL-321 was written to eliminate. The grace period closes that gap without
  giving up the settings fallback for sessions that legitimately never journal a transcript.
- The `ModelCacheGetOptions` type couldn't extend both `ResolveModelOptions` and
  `ResolveTranscriptModelOptions` — their `readFile` signatures diverge on the return-null
  vs return-undefined axis. The interface was upgraded to an intersection so a single
  `readFile` hook still satisfies both.

## Problems remaining

- The 60-second default grace is a heuristic; the real boot lag was ~15 s in run 09, so
  60 s gives comfortable slack. If a future CLI writes its first transcript line at very
  different latencies, the constant lives at one call site and can be tuned. Not exposed
  as an env var yet — the pattern the codebase prefers is "one constant, edit and ship",
  and premature configurability was pushed back per the model-economy discipline.
- The settings-hierarchy fallback is still available for old sessions with `absent`
  transcripts. That is intentional (a session that lives 5 minutes without a transcript
  is probably running against a misconfigured provider, and showing `unknown` forever
  hides a real problem). If a future MAJOR proves the fallback ALWAYS lies, drop it
  wholesale — this task leaves that call on the table.

## Pitfalls & workarounds

- The grace check treats negative ages (session `started_at` drifts ahead of `now()` under
  clock skew) as "still in grace". Reasoning: any ambiguity should collapse to `unknown`,
  never to a fabricated label. A unit test pins this.
- `modelCache.startTick()` at the top of `reconcileRoster` clears entries between ticks —
  the grace check runs once per session per tick, so no accumulated-state issues across
  ticks even if a session crosses the 60 s boundary mid-tick (it will re-resolve on the
  next tick after the boundary).
- The added test hook `now?: () => number` on `ModelCacheGetOptions` is deliberately
  optional — pre-existing tests that never touched the boot window keep passing without a
  bulk rewrite.

## What didn't make it

- Dropping the settings-hierarchy fallback entirely was considered (the MAJOR ticket's
  guidance said "consider dropping/quarantining"). Held back because a session that
  outlives the grace with an absent transcript is not a boot-window artefact — it's a
  provider-configuration issue, and the settings value is the best guess in that case.
  If future evidence shows the fallback ALWAYS lies, dropping it is a one-line change.
- A live end-to-end proof that spawns a real Sonnet CLI + drives fleet-poll's HTTP path
  was not attempted for MAJOR-1 — the in-process `reconcileRoster` proof exercises the
  exact code path with deterministic inputs, and spinning a full Claude CLI just to
  observe a NULL where the bug would have written "fable-5" adds cost without a new
  signal beyond what the unit tests + in-process proof already carry.

---

## Technical reference

- Commit: (added at land)
- Files touched:
  - `apps/core/src/adapter/model-resolver.ts` — new `ModelCacheGetOptions` intersection type, boot-window logic in `modelCache.get`.
  - `apps/core/src/workers/fleet-poll.ts` — pass `started_at_epoch_ms` on every resolve.
  - `apps/core/test/transcript-model.test.ts` — six new boot-window tests.
  - `.artifacts/live-proof-major1/proof.mjs` — in-process reconcile proof (worktree-only, not committed to `docs/`).
- New endpoint / migration: none.
- Verified by running:
  - `bun x tsc -p apps/core --noEmit` — clean.
  - `bun test apps/core/test/transcript-model.test.ts` — 26/26 pass (6 new).
  - `bun test apps/core` — 274/274 pass (all pre-existing green).
  - `bun .artifacts/live-proof-major1/proof.mjs` — prints the row shape and OK.
- Links:
  - Jira: <https://ainstance-labs.atlassian.net/browse/GSL-331>
  - GH issue: <https://github.com/ainstance-labs/gosleep/issues/332>
  - Run 09 finding #6: `docs/reports/verifications/web-e2e-2026-08-10/runs/09/index.html`
