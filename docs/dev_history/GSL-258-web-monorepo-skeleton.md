# GSL-258 — Web control plane: Bun-workspaces monorepo skeleton

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 3 (part 1) of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 9. Layout R1 per sections 5.1–5.3.

## What was done

The gosleep repo is now a Bun-workspaces monorepo root, without touching a single
existing tool. `bun install` at the root works cleanly, `apps/`, `packages/` and
`data/` exist as reserved directories with `.gitkeep` markers, and the runtime
data area is fully out of git.

Concretely:

- **Root `package.json`** — `{"name":"gosleep","private":true,"workspaces":["apps/*","packages/*"]}`. No dependencies yet; the workspace root only exists to hoist future apps/packages under one lockfile.
- **Root `bunfig.toml`** — an intentionally empty file with a short comment explaining why per-app tuning belongs under `apps/<name>/bunfig.toml`, so `bun run --filter='@gosleep/<name>'` stays deterministic.
- **`apps/.gitkeep`, `packages/.gitkeep`** — empty markers so the directories exist in git before GSL-260 / GSL-263 / GSL-265 fill them.
- **`data/.gitkeep`** — the directory shape is committed, but nothing inside is.
- **`data/.gitignore`** — local defense: `*` + `!.gitkeep` + `!.gitignore`. Any future accidental `git add data/whatever` is blocked at the subtree level, not only at the repo root.
- **Root `.gitignore`** — added a `data/**` clause with the two markers whitelisted, so the repo-level rule is visible without opening `data/.gitignore`.
- **`CLAUDE.md`** — new `## Monorepo layout (GSL-258, web control plane)` section (~40 lines) placed right before `## Gates`. Explains the new tree, `bun install` behavior, `data/` runtime policy, that the old world (`tools/lab/`, `chronicler.py`, `.claude/`) is untouched during the transition, and points at the smoke guard added below.
- **`tools/lab/smoke.sh`** — one new check `GSL-258: data/ stays out of git — only .gitkeep / .gitignore markers travel`. Uses `git ls-files data/` filtered against the two allowed paths; a single stray tracked file fails the gate.

## Problems solved

- **No lockfile churn.** With zero dependencies the empty `bun.lockb` gets deleted by `bun install`; no phantom lockfile ended up in the tree.
- **Not breaking the smoke.** The existing smoke harness is 4471 lines and hyper-strict about append-only discipline and receipts. The new guard is placed just before the `RESULT` line so the receipt (`.artifacts/lab/gates/smoke.json`) still records the total accurately (`PASS=546 FAIL=0`).
- **Not colliding with hooks.** All paths in `.claude/settings.json`, `tools/hooks/*`, and `tools/lab/*.sh` were left alone. The R1 layout was chosen precisely for this reason (see target-architecture section 5.2 impact table).
- **Ignoring the runtime DB, keeping the shape.** Both `.gitignore` files whitelist `.gitkeep` **and** `.gitignore` itself — without the second exception, the `data/.gitignore` file would ignore itself and would never travel with a fresh clone.

## Problems remaining

- None specific to this task. Follow-ups belong to later tickets:
  - GSL-259 will add the top-level generator lock in `chronicler.sh` and the web sentinel.
  - GSL-260 will introduce `apps/core/` (Hono skeleton with `healthz` / `version` / `whoami`) and switch on the `bun --filter='@gosleep/core' test` step in `tools/lab/gate.sh`.
  - GSL-265 will introduce `apps/web/` (React + Vite + shadcn + Tailwind v4 + Geist) and `packages/schema`, `packages/sdk`.
  - Two other smoke guards from architecture section 5.3 (`find apps packages -name '*.py'` = 0 and `find apps packages -name '*.sh'` = 0 outside a small allowlist) are deliberately deferred: they only start protecting anything after code lands in `apps/`, and they are already listed in later tasks' descriptions. Adding them now would be a no-op check that greens by absence rather than by policy.

## Pitfalls & workarounds

- **The `data/.gitignore` self-exclusion trap.** A file that only says `*` + `!.gitkeep` would delete itself from the tracked set on the next re-add. Second whitelist line — `!.gitignore` — is not optional. Verified with `git check-ignore -v`.
- **Scope conflict, resolved in favor of Jira.** The team-lead brief for this shift asked for `apps/core`, `apps/web`, `packages/schema`, `packages/sdk` scaffolds **and** a root baseline `tsconfig.json` inside this task. The GSL-258 Jira description explicitly restricts scope to *empty* `apps/` / `packages/` with `.gitkeep` (“filled in in the next tasks: `apps/core`, `apps/web`”) and lists no root `tsconfig`. Per project HARD RULE, the Jira description + architecture win. The scaffolds live in GSL-260 / GSL-263 / GSL-265; a root `tsconfig` is not required until then and can be added when the first workspace needs it.
- **Where the +40 lines went in `CLAUDE.md`.** The new section was inserted **before** `## Gates` so the delivery/gate/skill guidance below it stays adjacent to the safety rails. Any future edit that reorders top-level headings must keep the layout section above the operational sections; workers new to the repo need to see the layout before they read the gates.

## What didn't make it

- **No root `tsconfig.json`.** Deferred: no `.ts` under `apps/`/`packages/` yet. A root baseline is cheap to add when the first workspace pulls TypeScript in (target-architecture 3.3 shows each app already carries its own `tsconfig.json`, so a root one is only useful for `references` / `composite` — not needed today).
- **No apps/core, apps/web, packages/schema, packages/sdk scaffolds.** See "Pitfalls & workarounds" above.
- **No `bun` step added to `tools/lab/gate.sh`.** Jira says the `bun --filter='@gosleep/core' test` step is “additive” and only makes sense once there is an app to test. GSL-260 owns that edit.
- **No GitHub issue mirror yet.** Per epic anchor in GSL-250 Jira (“GitHub mirror: created after the first commit”), the mirror is opened at the epic level after this first commit lands; no per-task issue is expected on this project (see project CLAUDE.md conventions).

## Technical reference

- **Commit:** first commit on branch `GSL-250-control-plane` after `a904d0e`, message prefixed `GSL-258 …` (SHA retrievable via `git log --oneline --grep=GSL-258`).
- **Files created:**
  - `package.json`
  - `bunfig.toml`
  - `apps/.gitkeep`
  - `packages/.gitkeep`
  - `data/.gitkeep`
  - `data/.gitignore`
- **Files modified:**
  - `.gitignore` (added `data/**` block)
  - `CLAUDE.md` (new `## Monorepo layout` section before `## Gates`)
  - `tools/lab/smoke.sh` (added `GSL-258: data/` guard before `RESULT`)
- **Verified by running:**
  - `bun install` → `bun install v1.3.10 (30e609e0)` / `No packages! Deleted empty lockfile` / `[4.00ms] done`.
  - `git check-ignore -v data/gosleep.db data/snapshots/foo.db data/logs/core.log data/.gitkeep data/.gitignore` → ignored / ignored / ignored / whitelisted / whitelisted.
  - `bash tools/lab/smoke.sh` → `RESULT: PASS=546 FAIL=0` (the new `GSL-258` check reads PASS).
  - `bash tools/lab/gate.sh --offline` → `VERDICT: all gates green (offline mode — tracker NOT reconciled, say so in the report)`. Offline path is fine here: this task adds no code that the tracker would surface differently online.
- **Links:**
  - Jira: [GSL-258](https://ainstance-labs.atlassian.net/browse/GSL-258) — parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250)
  - Architecture: `docs/reports/web-harness-research-2026-08-03/target-architecture.md` sections 3.3, 5.1–5.3; rev-3 addendum for later-task context only.
