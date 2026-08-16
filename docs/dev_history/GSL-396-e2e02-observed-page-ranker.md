# GSL-396 — Observed page: reuse /fleet ranker for tmux_pane_ref

**Epic:** GSL-394 (E2E run-02 findings)
**Report anchor:** `docs/reports/verifications/harness-web-e2e-2026-08-17/runs/02/index.html` (M-1)
**Branch:** `GSL-394-e2e02-findings`

## Root cause

GSL-391 (E2E run-01 m3) moved the tmux-pane → agent_session join into a per-pane ranked
CTE on `/fleet`. The `/observed` page was still re-deriving attribution client-side in
`apps/web/src/screens/Observed.tsx` L235-241 with a weaker predicate:

```ts
const tmuxRef = tmux.data?.panes.find(
  (p) =>
    p.pane_current_path !== null &&
    s.cwd_project_root !== null &&
    p.pane_current_path.startsWith(s.cwd_project_root),
);
```

`startsWith` matches any pane whose cwd sits at-or-below the session's cwd — so a session
whose cwd is the repo ROOT (e.g. `gosleep-66` in the E2E fixture, `cwd_project_root =
/repo/gosleep`) is glued to the first pane whose cwd is any descendant (e.g. the fixture
worktree at `/repo/gosleep/.claude/worktrees/e2e02`). The panel showed
`tmux: e2e02-fixture:@51.%444` on `gosleep-66`'s Observed card — factually wrong.

## Fix

- **`apps/core/src/routes/paneRanking.ts`** (new): extracted the ranked SQL fragments
  (`HEURISTIC_PANE_CTE` + `PIDTREE_PANE_SUBQUERY`) that `/fleet` uses, so both surfaces
  share one source of truth. Any future refinement to the ranking rules lands here once.
- **`apps/core/src/routes/read.ts`** `/fleet` handler: now composes the CTE via the two
  imports (no behaviour change; all 10 `fleet.projection.test.ts` cases still pass).
- **`apps/core/src/routes/observed.ts`** `/observed/sessions`: projects
  `tmux_pane_ref` + `attribution` via the same ranked join.
- **`packages/schema/src/index.ts`** `ObservedSessionRow`: two new nullable fields
  (`tmux_pane_ref`, `attribution: "heuristic" | "pidtree" | null`).
- **`apps/web/src/screens/Observed.tsx`**: reads `s.tmux_pane_ref` directly. The
  client-side `.find(startsWith)` is gone; the shape now mirrors Fleet.tsx (label +
  `heuristic` tag when applicable).

## Red-first test

`apps/core/test/observed.sessions.attribution.test.ts` (4 cases, 14 asserts). The primary
case reproduces the E2E-run-02 fixture: `e2e02-1f` (cwd = worktree, pid + exact cwd) wins
the deeper pane; `gosleep-66` (cwd = repo root, ancestor) gets `tmux_pane_ref: null` and
`attribution: null` — no glue. Pre-fix, the test file could not even import the endpoint
symbols (the CTE was internal to `/fleet`); post-fix all 4 pass.

Extended safety net:

- `fleet.projection.test.ts` — 10 pre-existing cases still pass after the CTE move.
- Full core test suite (437 tests across 40 files) still green.

## Live leg (mandatory for M-1)

Scratch core booted from this worktree on port **7366** (prod 7331 never touched);
scratch DB at `.artifacts/e2e02fix/gosleep.db`; migrations applied via
`apps/core/scripts/migrate.ts`; observed collectors + fleet-poll + defer-reopen + jira-sync
all disabled so the seed is stable. Chrome attached via chrome-devtools MCP.

**Seed (mirrors run-02 fixture):**
- `e2e02-1f` — cwd = `/repo/gosleep/.claude/worktrees/e2e02`, pid 56412
- `gosleep-66` — cwd = `/repo/gosleep` (the parent), pid 42722
- pane `%444` — pane_current_path = `/repo/gosleep/.claude/worktrees/e2e02`

**API check** (`assets/GSL-396/02-observed-sessions-response.json`):

```json
{ "session_id": "e2e02-1f",  "tmux_pane_ref": "e2e02-fixture:@51.%444", "attribution": "heuristic" }
{ "session_id": "gosleep-66", "tmux_pane_ref": null,                     "attribution": null }
```

**Panel render** (`assets/GSL-396/01-observed-no-glue.png`): the `e2e02-fixture` card
shows `tmux e2e02-fixture:@51.%444 HEURISTIC`; the `observed:gosleep-66` card renders NO
tmux row (no glue). Pre-fix, the same fixture produced a `gosleep-66` card with
`tmux e2e02-fixture:@51.%444` glued in.

## Follow-ups

None for this task. Companion tasks: GSL-397 (m-2), GSL-398 (m-3), GSL-399 (m-4).
