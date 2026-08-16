# GSL-352 — Tmux map collector (2 s cadence, machine-wide, read-only)

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/observed/tmux.ts` — polls `tmux list-panes -a -F <FMT>` every 2 s (R14.5) and
UPSERTs one row per pane into `tmux_panes`. Enumerates the WHOLE tmux server — NO cwd-prefix
filter (R14.2). NEVER runs `capture-pane` (explicit non-goal).

Behaviour:
- First sighting of a pane emits `observed_events{kind:pane_appeared}` via the sanctioned
  writer (GSL-355). Subsequent sweeps refresh `last_seen` + reset `misses`.
- Missing pane increments `misses`; after `PANE_DISAPPEAR_THRESHOLD` (2 consecutive misses)
  emits `observed_events{kind:pane_disappeared}` once and stops re-emitting.
- Rows are never DELETEd — the disappear event doubles as a tombstone marker; historical
  visibility is preserved.
- `tmux` binary missing or socket unreachable → sweep no-ops. Collector is NOT disabled on
  that error (the operator may start a tmux server later); only real exceptions inside the
  parser trip the sentinel.

Side-effects declared for the sentinel review:
- READS: `tmux` binary via `Bun.spawnSync`.
- WRITES: `tmux_panes` (own table), `observed_events` via the sanctioned writer.
- SPAWNS: `tmux list-…` (read-only subcommands only — never `send-keys`, never
  `capture-pane`).

## Tests

`apps/core/test/observed.tmux.test.ts` — 4 tests: parseTmuxListOutput against a 4-pane
tab-separated fixture; foldScrape UPSERT + pane_appeared event counts; re-fold with same
rows shows 0 appeared / refreshed `last_seen`; two-sweep disappearance produces exactly one
`pane_disappeared` event.
