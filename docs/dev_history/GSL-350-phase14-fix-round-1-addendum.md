# GSL-350 — Fix round 1 addendum (verify-350 findings M1/M2/m3-m6)

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

Verifier verdict on the initial submission (run 01, HEAD `5194677`) was ALL-CLEAR NO with two
blockers + four minors. All six landed as three atomic commits and cleared on verify-350
run 02 (HEAD `ff83948`) with 6/6 CONFIRMED FIXED on the real path — adversarially proven:
M1 pane refs live via heuristic + badge; M2 native rows land with hook-owned columns
unclobbered; m3-m6 including two-way ended_at behave.

## Round-1 commits (verifier order)

- `da458a3` GSL-350 M1: pid-tree correlation + `attribution` fallback surfaced end-to-end.
- `ffb8b24` GSL-350 M2+m3+m5+m6: foldSessions upsert + name refresh + backfill tag +
  ended_at (all touching the same fold path).
- `ff83948` GSL-350 m4: soft-delete dead panes past PANE_PRUNE_THRESHOLD.

## New non-blocking findings filed as follow-ups

- **[GSL-359](https://ainstance-labs.atlassian.net/browse/GSL-359) R2-1** — pidtree primary
  path is inert under Claude CLI's write pattern (`lsof` finds no open transcript handles);
  heuristic carries 200/200 rows on the verifier's live sample. Consider swapping
  primary/fallback (or `pgrep` + cmdline parsing, or a batched lsof sweep).
- **[GSL-360](https://ainstance-labs.atlassian.net/browse/GSL-360) R2-2** — sessions-collector
  tick serializes 7-8 s under a 500+ historical-project backlog; tmux cadence (2 s per
  R14.5) slips during that window. Consider chunked folds, async subprocess batching, or a
  cold-storage skip filter.

Neither blocks merge — correctness holds, sentinel `write_attempts` stays at 0, R14.5 cadence
declaration remains truthful. Both are cost / efficiency polishes on top of a correct
observer mode.
