# GSL-391 — /fleet attribution: per-pane ranking + session_id dedup

**Parent epic.** [GSL-388](https://ainstance-labs.atlassian.net/browse/GSL-388) — "[Core][Web] E2E run-01 findings — heartbeat + prompt-boundary + attribution + reopen + one-click".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/384 (parent epic #381).
**Branch.** `GSL-388-e2e01-findings`.
**Commit.** `6179283`.

## What run-01 found

`docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01/index.html` finding #3:
`GET /fleet` bound the fixture pane to THREE sessions at once — the real fixture
(cwd = worktree, has pid), the orchestrator (same cwd, no pid), and a repo-root parent
session (cwd is a strict ancestor of the pane's path). The heuristic JOIN emitted one
row per matching `pane_current_path`; nested / shared cwd trees created ghosts. In
addition, sessions that matched multiple panes surfaced as duplicate rows in the API
response.

## Fix

The heuristic subquery in `apps/core/src/routes/read.ts::/fleet` was rewritten to rank
sessions per pane and keep only the winner:

```sql
LEFT JOIN (
  SELECT session_id, MAX(pane_ref) AS pane_ref
  FROM (
    SELECT a2.session_id,
           t.session_name || ':' || t.window_id || '.' || t.pane_id AS pane_ref,
           ROW_NUMBER() OVER (
             PARTITION BY t.pane_id
             ORDER BY
               CASE WHEN t.pane_current_path = a2.cwd_project_root THEN 0 ELSE 1 END,
               length(a2.cwd_project_root) DESC,
               CASE WHEN a2.pid IS NOT NULL THEN 0 ELSE 1 END,
               a2.updated_at DESC,
               a2.session_id
           ) AS rnk
    FROM agent_sessions a2
    JOIN tmux_panes t ON <same cwd-prefix predicate as before>
  ) ranked
  WHERE rnk = 1
  GROUP BY session_id
) heur ON heur.session_id = a.session_id
```

Rank order:
1. Exact `pane_current_path = cwd_project_root` beats any prefix match.
2. Deeper `cwd_project_root` wins (`length(cwd_project_root) DESC`).
3. Session with a non-NULL `pid` beats one without (live process > observed ghost).
4. Most recent `updated_at` breaks final ties; `session_id` guarantees a total order.

The outer `GROUP BY session_id` dedups at the API boundary so a session that wins many
panes surfaces exactly once. Losers get NULL pane_ref; the pidtree fallback keeps its
existing role for opt-in `GOSLEEP_OBSERVER_LSOF=1`.

The sibling-directory fence (GSL-373) is preserved verbatim in the ON clause — the
equality + `LIKE cwd || '/%'` predicate stays. GSL-380's empty-string cwd_project_root
guard stays too.

## Tests

`apps/core/test/fleet.projection.test.ts` — 3 new tests, 10/10 pass:
- "parent-cwd session loses the pane to the deeper (worktree) session" — reproduces
  the exact run-01 shape (fixture 53eb568b + orchestrator 5abd9a22 + repo-root parent
  2e5a1372 all matching one pane) and asserts each session appears once, the fixture
  wins, both ghosts get NULL.
- "two exact-cwd matches: session with a pid wins the tie" — isolates the pid
  tiebreaker clause.
- "a session that wins many panes appears exactly once" — asserts the outer-boundary
  dedup.

## Files touched

- `apps/core/src/routes/read.ts` — new heur subquery shape with ROW_NUMBER() + dedup.
- `apps/core/test/fleet.projection.test.ts` — 3 new tests.

## Residual questions (deferred for a future task)

- The parent-cwd session (2e5a1372 in the run-01 fixture) also had `pid=42722` set;
  the pidtree fallback correctly ignored it because no `tmux_panes.pane_pid` matched.
  If a future scenario has BOTH a heuristic-losing ancestor session with a live pid AND
  a pane whose pane_pid matches it, the pidtree fallback WILL bind them — that seems
  correct (pid match is the authoritative signal) but has not been live-verified this
  cycle. Note here for the next verifier pass.
- The observed panel duplicate-rows story: /fleet is now clean, but the report's note
  about "several observed sessions returned as duplicate rows" also mentioned it
  applied to /observed/sessions. That route doesn't JOIN with tmux_panes today so it
  doesn't produce this class of duplicate; if the report was referring to /fleet only
  (with duplicates then rendered in the Observed panel because it consumes /fleet),
  this fix closes the loop. If a separate /observed defect surfaces, file a follow-up.

## Gates

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core/test/fleet.projection.test.ts` — 10/10.
- Full core suite — 431/431 (pre-follow-up) / 433/433 (post-follow-up).
