// @gosleep/core — shared pane-attribution SQL (GSL-396, E2E run-02 M-1).
//
// GSL-391 (E2E run-01 m3) moved the tmux-pane → agent_session ranking into a per-pane
// ROW_NUMBER() CTE on /fleet. GSL-350 M1 / GSL-359 added the pidtree fallback for the
// heuristic-miss case. GSL-373 M1 pinned the sibling-directory guard (`= cwd OR LIKE cwd
// || '/%'`).
//
// The /observed page still re-derived attribution client-side with a weaker `startsWith`
// join (apps/web/src/screens/Observed.tsx L235-241) — that binds a session at the repo root
// to any deeper pane. The E2E run-02 fixture caught the defect live. Fix: share the same
// ranked SQL block with /observed/sessions so both surfaces agree.
//
// The two exports are SQL fragments a caller pastes verbatim inside a
// `LEFT JOIN (…) heur ON …` / `LEFT JOIN (…) pid ON …` block, alongside a base agent_sessions
// SELECT.  The ranking rules (kept in one place so any future refinement lands everywhere):
//
//   1. Primary heuristic — pane_current_path matches a session's cwd_project_root either
//      exactly (`=`) or via a strict sub-path (`LIKE cwd || '/%'`).  Per-pane ranking:
//        (1) exact `pane_current_path = cwd_project_root` beats any prefix match
//        (2) deeper `cwd_project_root` wins   (length DESC)
//        (3) session with a known `pid` beats one without (real live > observed ghost)
//        (4) most recent `updated_at`      (tie-breaker)
//        (5) `session_id` lexical           (final deterministic tie-breaker)
//      Keep only rank_per_pane = 1, then GROUP BY session_id so a session that wins many
//      panes surfaces exactly once (MAX pane_ref picks the deterministic winner).
//
//   2. Fallback — pane_pid == agent_sessions.pid (the GOSLEEP_OBSERVER_LSOF=1 opt-in
//      populates pid).  Fires only when the primary heuristic missed for THIS session.

/** SQL fragment for the primary heuristic CTE.  Alias it with `heur` in the outer query. */
export const HEURISTIC_PANE_CTE = `(
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
    JOIN tmux_panes t
      ON t.pane_current_path IS NOT NULL
     AND a2.cwd_project_root IS NOT NULL
     AND length(a2.cwd_project_root) > 0
     AND (t.pane_current_path = a2.cwd_project_root
          OR t.pane_current_path LIKE a2.cwd_project_root || '/%')
  ) ranked
  WHERE rnk = 1
  GROUP BY session_id
)`;

/** SQL fragment for the pidtree fallback subquery.  Alias it with `pid` in the outer query.
 *  Consumers ON-clause should read `heur.pane_ref IS NULL AND a.pid IS NOT NULL AND
 *  pid.pane_pid = a.pid` so the fallback fires only when the primary heuristic missed. */
export const PIDTREE_PANE_SUBQUERY = `(
  SELECT pane_pid,
         session_name || ':' || window_id || '.' || pane_id AS pane_ref
  FROM tmux_panes
)`;
