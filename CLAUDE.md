# gosleep — project anchors & delivery conventions

## Anchors (persisted per delivery-workflow §0 — do not guess, use these)

- **Jira:** project **GSL** ("GoSleep"), site `ainstance-labs.atlassian.net`,
  cloudId `74054cdc-47ef-497d-9684-734149876a8b`.
  Kanban board: https://ainstance-labs.atlassian.net/jira/software/projects/GSL/boards/100
  Transitions: To Do=11, In Progress=21, In Review=31, Done=41.
- **GitHub:** https://github.com/ainstance-labs/gosleep (org `ainstance-labs`, private).
- **Owner / assignee:** Roman L (rommxx@gmail.com), accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`.
  Assign every Jira issue to the owner at create time.

## Delivery conventions (skills: `delivery-workflow` + `using-jira`)

- Hierarchy: **Epic + Task only** (free-tier Jira; no Story).
- Issue summaries start with 1-3 `[Tag]` markers (`[Repo]`, `[Docs]`, `[Tooling]`, `[Process]`,
  `[Evals]`, `[Skill]` — reuse before inventing).
- **One branch per Epic:** `<EPIC-KEY>-<slug>` (e.g. `GSL-1-project-init`).
- **One commit per Task:** message starts with the Task key — `GSL-N short description`.
- **One PR per Epic:** title `<EPIC-KEY> …`; body has `Implements <EPIC-KEY>.`, a Tasks checklist,
  `Mirrors GH #<n>.`, `Closes #…` list. PR stays open until every Task is Done; **regular merge**
  (preserves one-commit-per-task history), never squash.
- **GitHub Issues mirror Jira** (labels `epic` / `task`, cross-links in both directions).
  GitHub numbering is shared between issues and PRs — trust in-body links, not numbers.
- **Dev history:** one file per Task at `docs/dev_history/<TASK-KEY>-<phase>-<slug>.md`
  (key UPPERCASE first), written right after the task lands. Index: `docs/dev_history/README.md`.
  (Legacy pre-GSL history, the TLM-era `docs/dev-history/` folder, was deleted by the owner on
  2026-07-26 as no longer relevant — do not recreate it.)

## Monorepo layout (GSL-258, web control plane)

The web control plane epic (GSL-250) introduces a Bun-workspaces monorepo on top
of the existing tree. The layout is R1 from
`docs/reports/web-harness-research-2026-08-03/target-architecture.md` sections
5.1-5.3.

```
gosleep/                  # workspace root
├── apps/                 # NEW: gosleep-core (GSL-260), gosleep-web (GSL-265, later)
│   ├── core/             # GSL-260: Bun + Hono 4 API on 127.0.0.1:7331
│   │                     #   src/{serve,config}.ts, src/routes/read.ts,
│   │                     #   src/security/{host,origin,bearer,keychain}.ts,
│   │                     #   bin/touchid-gate.swift (source only; .app-bundle
│   │                     #   build is GSL-264 per rev-3 addendum Delta 4),
│   │                     #   plist/com.gosleep.core.plist + plist.sh install|uninstall|status,
│   │                     #   install-deps.sh (bun + swiftc check).
│   └── web/              # GSL-265: React 19 + Vite 7 + shadcn client
├── packages/             # NEW: shared TS layers
│   ├── schema/           # zod + drizzle types, reused by core and web
│   └── sdk/              # typed fetch/SSE client for apps/web
├── data/                 # NEW: SQLite source of truth, snapshots, logs — NOT in git
├── tools/                # UNCHANGED: chronicler.sh, lab-emit.sh, gate.sh, smoke.sh
├── docs/                 # UNCHANGED: lab/, prd/, plans/, handoff/, reports/
├── skill/                # UNCHANGED
├── .claude/              # UNCHANGED — hooks and settings survive the migration
├── package.json          # workspaces: ["apps/*", "packages/*"], private
├── bunfig.toml           # root Bun config (per-app configs live under apps/*)
└── CLAUDE.md
```

- **Install:** run `bun install` at the repo root. There is a single
  `bun.lock` (text format under Bun 1.3.x; older docs said `bun.lockb`) at
  the root; per-package lockfiles under `apps/*` and `packages/*` are a
  mistake — delete them if they appear.
- **Run one package:** `bun run --filter='@gosleep/core' dev` starts the
  core server on `127.0.0.1:7331`. Filter names match the `name` field in
  each workspace's `package.json`.
- **Typecheck one package:** `bun x tsc -p apps/core --noEmit` — clean
  after `bun install` at the root.
- **Endpoint smoke:** `bash tools/lab/tests/core-smoke.sh` boots
  `apps/core/src/serve.ts` under a dev-env Bearer, curls the three v1
  read endpoints across seven scenarios (healthz public, version/whoami
  need Bearer, wrong Host → 421), kills the server, asserts port clean.
  Not wired into `gate.sh` (starts a process); run by hand around
  changes to `apps/core/`.
- **Launchd:** `apps/core/plist.sh install` renders the plist template,
  puts the Bearer secret in Keychain (`gosleep-web` service, account
  `$USER`, wrapped as `b64v1:<base64>`), and bootstraps the agent under
  `gui/$UID`. `uninstall` boots it out. `status` prints one JSON line
  (`installed / loaded / healthz / pid`). Rotate WITHOUT bouncing launchd:
  `apps/core/plist.sh rotate-secret`. Full setup + troubleshooting flow:
  `docs/runbooks/gosleep-core.md` (GSL-269).
- **Read core logs:** `tail -n 50 -f data/logs/core.{out,err}.log | jq -c .`
  — every line is JSON. Timeline events land in the DB (`sqlite3
  data/gosleep.db 'select ts, actor, event, seq from events order by seq
  desc limit 20;'`); Prometheus metrics at `curl -s
  http://127.0.0.1:7331/metrics` (14 families, GSL-280).
- **Snapshot by hand:** `bash apps/core/scripts/snapshot.sh` writes
  `data/snapshots/$(date -u +%F)/gosleep.db + status.json`. The daily
  launchd cron runs the same script at 04:00 local, retention 30 days.
- **Preact-SSG is deprecated (GSL-270):** the owner reads live data at
  `http://127.0.0.1:7331`. `docs/lab/site/*.html` files stay in git as a
  frozen 1-2 month rollback surface — the chronicler no longer regenerates
  them by default. Roll back with `GOSLEEP_KEEP_STATIC_SITE=1` if the
  panel is unreachable.
- **`data/` lives out of git:** the runtime SQLite database (`gosleep.db`,
  `-wal`, `-shm`), daily snapshots in `data/snapshots/`, and core logs in
  `data/logs/` are all git-ignored (root `.gitignore` + `data/.gitignore`).
  Only `.gitkeep` and `.gitignore` are tracked so a fresh clone still has the
  directory. Never `git add data/gosleep.db`.
- **Old stays put during the transition:** `tools/lab/`, `chronicler.py`,
  `.claude/settings.json`, hooks, gates — none of that moves until the final
  switch (GSL-271). New code goes only under `apps/` and `packages/`.
- **Web question-loop pilot (GSL-267, opt-in guarded).** `.claude/settings.json`
  wires `PreToolUse{AskUserQuestion,PermissionRequest}` matchers to the two
  shims. The shims exit 0 instantly unless the session was launched with
  `GOSLEEP_WEB_QUESTIONS=1` — so a plain `claude` command is unchanged (TUI
  dialog as today). Opt a session INTO the pilot with
  `env GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_INTERNAL_SECRET=<same as running core>
  claude …`; then `AskUserQuestion` routes to `POST /internal/questions/post`
  → panel → `POST /actions/questions/answer` → agent proceeds. Full flow +
  widening + rollback: `docs/runbooks/gosleep-core.md` § 8. Widening to all
  sessions requires an explicit owner command (owner decision d-2026-08-08-001).
- **Smoke guard:** `tools/lab/smoke.sh` enforces that `data/` contains only
  the `.gitkeep` / `.gitignore` markers. If you need to commit anything under
  `data/`, you are on the wrong path — that content belongs in a migration,
  a snapshot script, or the schema package.

## Gates

No CI yet. After editing `skill/<name>/`, verify by targeted sync of THAT skill only:
`rsync -a skill/<name>/ ~/.claude/skills/<name>/`. ⚠️ **`./install.sh` целиком агентам ЗАПРЕЩЁН**
(owner 2026-07-20) — он синкает ВСЕ подпапки и перезаписал бы глобальный
`orchestrating-delivery-agents` (глобальная копия авторитетна; см. Safety rules). Report
generators and the eval runner per README "Use" (fix stale ROOT paths first — GSL-4).

## Skill source of truth

`skill/` is the source of truth for **all 5 owned skills**, each in its own named subfolder:

```
skill/
  orchestrating-delivery-agents/   # SKILL.md + references/
  delivery-workflow/               # SKILL.md
  handoff/                         # SKILL.md
  using-jira/                      # SKILL.md
  writing-prds/                    # SKILL.md
```

`./install.sh` installs **every subfolder** under `skill/` into `~/.claude/skills/<name>/`
using `rsync -a --delete`. Sync direction is always **local → global**.

**Safety rules (hard):**
- ⚠️ **2026-07-20 (owner): `orchestrating-delivery-agents` — авторитетна ГЛОБАЛЬНАЯ копия**
  (`~/.claude/skills/orchestrating-delivery-agents/`), в локальной `skill/` есть проблемы.
  НИКОГДА не перезаписывать глобальную автоматически: `./install.sh` целиком не запускать
  (ни агентом, ни хуком); отдельные скиллы ставить только точечным
  `rsync -a skill/<name>/ ~/.claude/skills/<name>/`, и никогда — `orchestrating-delivery-agents`
  без явного указания владельца.
- `--delete` is scoped to individual named skill dirs (`~/.claude/skills/<name>/`).
- The script NEVER runs `rsync --delete` or `rm` against the parent `~/.claude/skills/` itself.
- Unrelated global skills (`gstack`, `gsd-*`, plugins, etc.) are never touched.

**Before running `./install.sh`:** ensure `skill/` is not behind the global copy. If you suspect
the global is newer, reverse-sync first: `rsync -a "$HOME/.claude/skills/<name>/" "skill/<name>/"`
and commit before running the installer.

**Editing a skill IS a shift-closing item (GSL-189, root treatment for R5 "learning loop has
no executor").** Every shift-closing agent runs the three-item checklist codified in
`skill/handoff/SKILL.md` Procedure step 7 before writing the handoff: (a) skim for a lesson
worth recording into an authoritative skill; (b) if there is one, file a `[Skill]`-tagged GSL
Task, edit the appropriate copy, publish via `tools/skills/publish.sh <name>` (never bypass
it); (c) link the lesson-to-Task in the handoff's "Comments" section. Silence must be
explicit ("no skill lessons this shift"), not implicit — a handoff missing the checklist is
incomplete regardless of how good the rest reads.
