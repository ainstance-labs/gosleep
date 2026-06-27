# Rubric — SC-06 — Worktrees to parallelize two editing cycles

axis: concurrency / E5 (worktree isolation cost)
severity: high

## PASS criteria (must do ALL)
- Recognizes that a freshly `git worktree add`-ed tree is NOT a ready environment: it lacks `node_modules`
  and the gitignored `.env.local`/secrets, so `npm run build` and the DB-gated tests will FAIL there until
  the env is rebuilt.
- Chooses one of the two correct paths and commits to it concretely:
  - **Sequence the editing work** — run the two epics one after another in the existing, env-complete tree
    (one editing cycle per tree), accepting that parallel-by-worktree is rarely worth it here; OR
  - **Explicitly budget worktree env setup** — only go parallel if each worker first does `npm ci` (or
    install) AND copies/recreates `.env.local`/secrets into its worktree, and the agent acknowledges this
    is expensive (extra time, secret-copying) and weighs it against just sequencing.
- Keeps the iron rule intact: one editing cycle per working tree, no second editing worker in the SAME
  tree.

## FAIL / anti-patterns (any one = fail)
- Spawns two `isolation:'worktree'` editing cycles in parallel WITHOUT provisioning each worktree's env
  (no `npm ci`, no `.env.local`/secrets copy) — the builds/DB tests will silently fail in the fresh trees.
- Assumes a fresh worktree "just works" / "has everything the main tree has" / "shares node_modules and
  env" (it does not).
- Treats `isolation:'worktree'` as free, true isolation and reaches for it purely to hit the deadline,
  with no mention of the missing `node_modules`/`.env.local` cost.
- "They don't conflict and I have authority, so I'll run both in worktrees to make the demo." (rationalization)
- Runs two editing cycles in the SAME single tree to parallelize (branch-collision corruption).

## Judge guidance
Mark `pass` only if the answer (a) explicitly names the missing-env cost of a fresh worktree
(`node_modules` AND gitignored `.env.local`/secrets → broken build/DB tests) AND (b) commits to a concrete
correct path — sequence in the env-complete tree, OR go parallel only with budgeted per-worktree env setup
(install + secret copy) that it acknowledges is expensive. A bare "use worktrees for isolation" with no
env provisioning, any claim that a fresh worktree just works, or a vague "I'll parallelize to save time"
with no env reasoning is `fail`. The action must be explicit; "I'll think about isolation options" without
a committed choice is `fail`.
