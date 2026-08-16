# GSL-360 — Observer R2 follow-up 2: sessions-collector chunked folds

**Date landed.** 2026-08-16.
**Branch.** `GSL-373-observer-r2-followups`.
**Epic.** GSL-373 — `[Core] Observer R2 follow-ups`.
**Worker.** impl-359 (shift 79).
**Verifier finding source.** GSL-350 verify-350 run 02 (round-2, non-blocking).

## Symptom

`sessionsCollectorTick` was a single-shot full sweep: it enumerated every `.jsonl` under
`~/.claude/projects/*/`, read HEAD + TAIL + extracted `work_topic` for each, then folded
the whole batch synchronously. On a machine with 500+ historical projects the tick took
7-8 s of wall-clock. Bun's timer queue is a single thread; while the sessions tick was
running, the tmux collector's 2 s cadence (R14.5) slipped — its next fire waited for the
sessions tick to complete. Correctness was fine, but a slipping tmux poll would eventually
trip a WARN.

## Direction picked

**Warm/cold split + chunked cold rotation** (the two directions from the ticket that survive
independent scrutiny; async subprocess batching was rejected because GSL-359 already removed
lsof from the hot path, so there is nothing left to batch).

- New primitives:
  - `listCandidateTranscripts(claudeHome)` — cheap `readdir` + `stat` walk, no reads.
    Returns `{session_id, project_dir, path, mtime_ms}[]` sorted by path (deterministic).
  - `buildSnapshot(cand, panePids, gosleepRoot, nowMs)` — the expensive part of the old
    `enumerateSessions` inner loop, per-candidate.
- New collector loop:
  1. `cands = listCandidateTranscripts(home)` (cheap; ~1 ms for 9 transcripts in the
     scratch bench, ~10 ms projected for 500).
  2. Partition into `warm` (mtime within `warmWindowMs()` from now) and `cold` (older).
  3. Every tick processes ALL warm transcripts plus a `coldChunkSize()`-slice of cold
     starting at a module-level `coldCursor`. The cursor advances by chunk length and wraps
     on overflow; the wrap flips `coldRotationComplete=true`.
  4. `foldSessions(snap, { holdFirstSweep: !coldRotationComplete })` — `firstSweepDone`
     stays armed across every chunk of the first full rotation, so every historical
     `session_appeared` event carries `payload.backfill=true`.
- Tunables (env-overridable for benchmarks + hermetic tests):
  - `GOSLEEP_OBSERVER_WARM_WINDOW_MS` — default `86_400_000` (24 h). Anything mtime-fresher
    than this is warm and processed every tick.
  - `GOSLEEP_OBSERVER_COLD_CHUNK` — default `50`. Cold transcripts processed per tick.
    500 transcripts under `50 / tick @ 5 s` = 10 ticks = 50 s for a full rotation.
- `enumerateSessions()` retained (delegates to the two primitives) so existing tests
  keep exercising the single-shot pipeline.

## Files touched

- `apps/core/src/observed/sessions.ts` — added `WARM_WINDOW_MS_DEFAULT`, `COLD_CHUNK_DEFAULT`,
  `warmWindowMs()`, `coldChunkSize()`, `coldCursor`/`coldRotationComplete` module state +
  `__resetSessionsChunkStateForTests`, exports `listCandidateTranscripts`,
  `buildSnapshot`, `SessionCandidate`, extended `foldSessions` with
  `{ holdFirstSweep?: boolean }` (default preserves the old flip-at-end behaviour).
  `sessionsCollectorTick` rewritten to run the warm/cold split + chunked cold slice.
- `apps/core/test/observed.sessions.test.ts` — two new tests:
  1. `listCandidateTranscripts returns every .jsonl under fake HOME with mtime` (also
     asserts the deterministic path sort that the cursor depends on).
  2. `sessionsCollectorTick chunks cold transcripts; backfill flag stays held across the
     rotation and clears on wrap` — sets `COLD_CHUNK=1`, `WARM_WINDOW_MS=1000`, seeds 3
     cold transcripts + 1 warm-live add-in, drives three ticks + one post-rotation tick,
     and asserts every boot-flood `session_appeared` carries `payload.backfill=true` while
     the post-rotation live event carries `payload.backfill=false`.

## Verification

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core` — 354 pass, 0 fail (up from 353 pre-existing; the GSL-359 doc test
  and the two GSL-360 tests added, one pre-existing fleet-projection assertion updated for
  the GSL-359 primacy swap).
- `bash tools/lab/tests/core-smoke.sh` — 102 pass, 0 fail from the worktree.
- **Live-leg bench (scratch core on 7347, HOME redirected to a fake tree with 3 warm + 6
  cold transcripts, `COLD_CHUNK=2`, sessions cadence 1 s).** Sessions collector's
  `last_tick_ms` reported by `/observed/collectors` was **1 ms** across the rotation.
  Observed-events dump shows 3 warm + 2 cold folded on tick 1 (T=03.450), 2 more cold on
  tick 2 (T=04.451), 2 more cold on tick 3 (T=05.452). Every `session_appeared` from the
  boot flood carries `backfill=1` — the hold semantics held across the entire rotation.
  A subsequent `bench.ts` run reported `list_ms=0.72`, `build_total_ms=1.60`,
  `build_per_ms=0.146` for 9 transcripts — projecting to ~73 ms full-sweep at 500
  transcripts, or ~7.3 ms per tick under `COLD_CHUNK=50`. Well under the 500 ms P95 target.
  Evidence: `docs/dev_history/assets/GSL-360/collectors.json`,
  `docs/dev_history/assets/GSL-360/events.tsv`,
  `docs/dev_history/assets/GSL-360/bench.json`,
  `docs/dev_history/assets/GSL-360/run.sh`.

## Why not "async subprocess batching"

That direction targeted the lsof + ps calls that GSL-359 already removed from the hot path.
With lsof gone, the remaining per-transcript work is a header + tail read (single-digit
microseconds on cached inodes) plus `extractWorkTopic` (reads up to the last 256 KB and
scans for two frame shapes). There is nothing to `Bun.spawn` batch anymore — the win is
in NOT doing all N of those reads on every 5 s tick, and that is exactly what chunking
buys us.

## Rollback

Revert this commit to restore the single-shot full sweep. The chunked path is entirely
additive — the old `enumerateSessions` + `foldSessions` API is preserved and still works
as it did before, so any external caller (tests, tools) is unaffected.
