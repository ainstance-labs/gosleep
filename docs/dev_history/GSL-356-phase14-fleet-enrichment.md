# GSL-356 — /fleet enrichment: project_slug + tmux_pane_ref + observed_only badge

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/routes/read.ts` — `/fleet` now LEFT JOINs `tmux_panes` on `pane_pid =
agent_sessions.pid` so every row carries the human-readable pane ref (`session_name:window_id.pane_id`)
when a pane is correlated. Rows without a correlator get NULL — the panel renders "—".

New response fields per row:
- `project_slug: string | null`
- `cwd_project_root: string | null`
- `observed_only: boolean` (from `agent_sessions.observed_only`, mapped 0/1 → false/true)
- `tmux_pane_ref: string | null`

The `observed_only=true` rows are exactly the sessions Phase A must show without empowering:
Fleet cards render them with a muted `observer only` badge (title tooltip explains WHY —
Phase 15 will add runtime Take-control), plus project chip + tmux pane ref in the sub-header
(GSL-357 web-side changes).

R14.3 posture: gosleep-native rows behave exactly as before GSL-297 (Phase 14 non-goal —
"any behaviour change on non-observed rows"). The muted badge + disabled affordances are the
only visible change on observed rows.

## Tests

`apps/core/test/fleet.projection.test.ts` — scratch schema extended with the three new
columns and a `tmux_panes` table. New test case seeds:
- a native gosleep row (`observed_only=0`, pid=4444),
- an observed scratch-repo row (`observed_only=1`, pid=5555),
- a matching tmux pane with `pane_pid=5555` and `session_name=obs-shell`.

Asserts the observed row surfaces `observed_only=true`, `project_slug="scratch"`,
`tmux_pane_ref="obs-shell:@0.%9"`; native row surfaces `observed_only=false` and
`tmux_pane_ref=null` (no pane with pid=4444).
