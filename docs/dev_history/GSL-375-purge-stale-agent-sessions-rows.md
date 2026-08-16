# GSL-375 — Purge stale `agent_sessions` rows for deleted transcripts

**Parent epic.** [GSL-387](https://ainstance-labs.atlassian.net/browse/GSL-387) — "[Core][Web][Tooling] Shift-79 verifier follow-up bundle".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/365 (parent epic #377).
**Branch.** `GSL-387-verifier-followups`.

## What changed

The GSL-373 adversarial verifier (`docs/reports/verifications/GSL-373/runs/01/`) reproduced a pre-existing behavior: `foldSessions` in `apps/core/src/observed/sessions.ts` upserted a row for every session it observed in the current snapshot but never DELETEd, ENDed, or expired a row whose transcript.jsonl vanished from disk between ticks. The verifier deleted `sess-cold-3.jsonl` mid-flight and watched the row survive over 12 seconds and 4 collector ticks with its pre-delete `ended_at` intact (evidence: `docs/reports/verifications/GSL-373/runs/01/assets/06-fleet-final.json`). Not a GSL-359/360 regression — introduced with the original sessions collector.

Impact: `/fleet` accumulates rows for transcripts the owner has since pruned. The fleet count in the header no longer matches the real fleet after enough churn.

## Fix

Added `purgeMissingTranscripts(candidateSessionIds, budget?, claudeProjectsDir?)` to `apps/core/src/observed/sessions.ts`:

- Selects only `observed_only=1` rows from `agent_sessions` in stable order (`session_id ASC`), so a persistent backlog progresses deterministically across ticks. Native rows (co-owned by the fleet-poll worker) are never visited.
- Compares each row's `session_id` against `candidateSessionIds` (a Set built from the tick's `listCandidateTranscripts()` snapshot). A row not in the set is a purge candidate.
- **Belt-and-braces vanish-mid-tick re-check**: before DELETE, re-scans `~/.claude/projects/*/<session_id>.jsonl` — if the file appeared between the listing and the purge, the row is preserved and counted under `skipped_still_exists`. Prevents a lost-race DELETE.
- Emits `session_ended` on the observed-events bus with `{ session_id, was_status, reason: "transcript_missing" }` BEFORE the DELETE, so subscribers reading in the same tick still see the row.
- Bounded per call by `PURGE_BUDGET_PER_TICK = 32`. A mass-delete is absorbed across several ticks instead of blocking one tick with hundreds of DELETEs.
- If the observed-events writer refuses the append (sentinel / shape reject), the DELETE is skipped — no silent purge without a timeline signal.

Wired into `sessionsCollectorTick` AFTER `foldSessions`, guarded by `coldRotationComplete`. The purge only runs once the first full cold rotation has completed — before that, the candidate set may still be growing across boot chunks and a premature purge would race the boot backfill. The `claudeHome` test hook propagates through to `purgeMissingTranscripts` via a computed `claudeProjectsDir` argument.

Added `"session_ended"` to `ObservedKind` in `apps/core/src/observed/events.ts`. The DB `observed_events.kind` column is a soft TEXT enum (no check constraint), so consumers that don't yet handle it simply ignore the value.

## Files touched

- `apps/core/src/observed/events.ts` — added `"session_ended"` to `ObservedKind`.
- `apps/core/src/observed/sessions.ts` — added `PURGE_BUDGET_PER_TICK` and `purgeMissingTranscripts`; wired it into `sessionsCollectorTick` behind the `coldRotationComplete` guard.
- `apps/core/test/observed.sessions.test.ts` — new `describe("GSL-375 purge stale …")` block with 4 tests:
  1. Transcript vanishes between ticks → `session_ended` fires + row DELETEd.
  2. Vanish-mid-tick: candidate set says gone but transcript is still on disk → row preserved, `skipped_still_exists` counted.
  3. Mass-delete: `PURGE_BUDGET_PER_TICK + 3` rows → first call purges exactly `PURGE_BUDGET_PER_TICK`; second call sweeps the rest.
  4. Native rows (`observed_only=0`) are never purged, even with an empty candidate set.

## Verification

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core` — **360 pass / 0 fail / 1005 expects** (was 356; +4 new).
- Test file `observed.sessions.test.ts` alone: **14 pass / 0 fail / 82 expects** (was 10; +4).

## Notes / decisions

- Preferred option 1 from the ticket (path-check sweep) — maps 1:1 to observable disk state. Option 2 (age-based mtime cutoff) would keep phantom rows around N days after their transcript vanished; the ticket's stated pain (`/fleet` header count drift) demands immediate reconciliation.
- Chose DELETE over an `expired_at` marker. The row is a projection of the transcript's existence — once the source is gone, the projection has no meaning. If any future feature needs to remember "was here yesterday", the observed-events audit trail (`session_ended` + `session_appeared` history) is the durable record.
- Only `observed_only=1` rows are purged. Native rows might legitimately have their transcript wiped by an orchestrator while the tmux pane is still live — the fleet-poll worker re-touches them on its next tick with whatever it can observe. Purging them here would race that worker.
- The purge runs on EVERY tick once `coldRotationComplete=true` (not just cold ticks). Cheap: one SELECT + at most one readdir + at most `PURGE_BUDGET_PER_TICK` DELETEs. The full disk scan is already happening in `listCandidateTranscripts` at the top of the tick — reusing that Set is free.
