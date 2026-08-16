# Handoff — gosleep-e2e-todo (todo-plugins-run01 fixture) — 2026-08-16 (todo-plugins-run01-pr)
> For a FRESH agent. Read Part 1 (plain words) first to get oriented, then Part 2, then "Immediate next steps".
> No prior handoff exists for this repo (`docs/handoff/` does not exist yet) — this is the first one, nothing to supersede.
> Status of record: GitHub only. No Jira epic was opened for this task (see "Comments" below) — do not assume a GSL key exists for it.
>
> **Path note:** the owner explicitly asked for this file at `/tmp/gosleep-plugins-run01-handoff.md`, overriding this
> skill's default `docs/handoff/<NN>-<date>-handoff-<topic>.md` convention. It is NOT committed to the repo and will
> not survive a reboot — treat it as disposable proof-of-execution, not the durable handoff of record.

# ── Part 1 · Plain words ──

## 1. Where we are now
This is the `gosleep-e2e-todo` fixture repo — a permanent, disposable test surface the gosleep harness uses for
live-fire E2E runs (question interception, permission gating, panel supervision). This particular run
(`todo-plugins-run01`) built a small scratch to-do app and opened a PR. The work is done and the PR is open,
unmerged, on GitHub.

## 2. What's already done
A Vite + React + TypeScript to-do app (`gosleep-todo-e2e`) was scaffolded at the repo root. The owner picked
"Rows list" rendering over "Card grid" via an explicit question. It has add/toggle/delete, a filter (all /
active / completed), and sort by title or created-at with a direction toggle. `tsc -b`, `oxlint`, and
`vite build` all pass clean; the dev server was smoke-tested and serves the page. Everything landed in one
commit on `feature/todo-rows-list-filter-sort`, pushed, and opened as PR #12 against `main`.

## 3. What we're doing next
Nothing is queued. The task as given (scaffold + rows list + filter/sort + PR) is complete. The only
realistic next step is the owner reviewing/merging PR #12, or asking for follow-up changes on the same
branch.

## 4. Problems we have
None blocking. Two things worth knowing: (a) this repo already has five other open, unmerged PRs from
earlier runs (#3, #7, #8, #9, #10, #11) — that's expected fixture behavior per its README, not a regression
from this session; (b) no automated test suite exists yet (build/lint/manual smoke test only) — a fresh agent
adding features should not assume Jest/Vitest/Playwright coverage is present.

## 5. Comments & recent decisions
This task was run ad hoc (owner instructions in chat), not through the `delivery-workflow`/`using-jira`
Epic+Task process — no Jira issue or GitHub issue mirror was created for it, unlike the earlier
`GSL-315`/`GSL-316`/`GSL-317` runs visible in this repo's history. `.claude/` in the working tree is local-only
harness wiring (absolute-path hooks) and was deliberately left untracked/uncommitted — the repo's README says
this repo does not carry it.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules
- Never push production-quality code here — it's a disposable test surface (per repo README).
- Never delete/rename this repo; never mirror its issues into `ainstance-labs/gosleep`.
- Never commit `.claude/` from this working tree — it holds absolute local paths, not portable.

## How we work
No formal process was invoked for this task. For anything Jira/GitHub-tracked in this repo going forward, use
the `delivery-workflow` skill (Epic + Task only, one PR per Epic, one commit per Task, branch prefixed with
the Jira key, GitHub Issues mirror Jira).

## Connections
| What | Value |
|---|---|
| GitHub repo | `ainstance-labs/gosleep-e2e-todo` (origin, fetch+push) |
| This PR | #12, `feature/todo-rows-list-filter-sort` → `main`, OPEN, MERGEABLE |
| Other open PRs | #3, #7, #8, #9, #10, #11 (earlier runs, unrelated to this task) |
| Jira | none opened for this task; repo's general test-run epic historically `GSL-315` (per README, may already be closed) |
| Env vars | none required for this app (pure client-side Vite/React) |
| Local harness wiring | `.claude/settings.json` (untracked, absolute paths, not portable — see README §"Runbook for a fresh run") |

## Gates
```
npm install
npx tsc -b        # or: npm run build  (tsc -b && vite build)
npm run lint       # oxlint
npm run dev         # manual smoke test
```
All four were run this session and passed clean on commit `8ef9b0d`.

## What exists in code
| Module | State |
|---|---|
| `src/App.tsx` | Built — add/toggle/delete, filter, sort, all wired to local `useState` |
| `src/types.ts` | Built — `Todo`, `CompletedFilter`, `SortField`, `SortDirection` |
| `src/App.css` / `src/index.css` | Built — rows-list styling, light/dark tokens carried from the vite scaffold |
| Persistence | None — in-memory only, resets on reload (not requested, not built) |
| Tests | None — build/lint/manual smoke test only |

## Immediate next steps
No open task. If resuming:
1. `git fetch origin && git checkout feature/todo-rows-list-filter-sort`
2. `gh pr view 12 --web` to check review/merge status
3. If the owner wants changes: edit on this branch, re-run the Gates above, commit, `git push`

## Read first
- `README.md` (repo root) — fixture purpose, "Do NOT" list, runbook for a fresh run.

## Gotchas
- `npm create vite@latest <path>` mis-resolves an **absolute** target path against `cwd` in this environment
  (it nested a `private/tmp/...` tree inside the repo instead of scaffolding at the given absolute path). Fix:
  `cd` into the target parent dir first and pass a relative name, or scaffold in a scratch dir and copy files
  in — don't pass an absolute path directly to `create-vite`.
- The vite `react-ts` template ships its own `README.md`, `hero.png`/`react.svg`/`vite.svg` demo assets, and a
  marketing-page `index.css`/`App.css` — all unused boilerplate for a to-do app. They were manually deleted
  (assets, `public/icons.svg`) and `index.css` trimmed to just the color-token reset. A fresh scaffold in this
  repo will reintroduce them.

## Blocked on the human
None. PR #12 is ready for review at the owner's convenience.
