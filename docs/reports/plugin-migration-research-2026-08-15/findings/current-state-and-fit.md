# Skills → Plugins migration — the "our reality" half

**Author:** res-fit (research worker).
**Date:** 2026-08-15.
**Scope:** current state of the gosleep skills system + fit/gap onto Claude Code plugins.
**Companion:** the "plugins world" report from res-plug (Anthropic docs, plugin lifecycle, marketplace mechanics, versioning).
**Mode:** read-only inventory + fit sketch — not a design.

Every fact below is sourced with a file path, a line number, or a raw command output.
This document is deliberately in the same directory as the future migration decision
so the eventual PRD can cite it verbatim.

---

## 0. Executive summary

- **Scope-expansion note (owner via team-lead, 2026-08-15):** the migration inventory is NOT
  just the seven in `skill/`. The owner has also authored **5 additional skills that live
  ONLY under `~/.claude/skills/` with NO repo copy at all** —
  `agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`,
  `extra-usage`, `verifier-skeptic`. These have the worst versioning story of the whole
  fleet: not just "mtime and nothing else on the prod side" (the pain that applies to the 7)
  but "mtime and nothing else, PERIOD" — no dev copy in any repo, no git author, no commit
  trail anywhere. See §1.5 for the positive-identification inventory + evidence. In-scope
  for the migration.
- We own **7 skills tracked in `skill/<name>/`**. All 7 also exist under
  `~/.claude/skills/<name>/`. After `GSL-251` (commit `db30235`, reverse-sync O1, 2026-08-10)
  `diff -rq` between the local dev copy and the global production copy is **empty for every
  one of them** — measured live 2026-08-15 (see raw output §2.2).
- Total confirmed owner-authored skills across the fleet: **12** — the 7 tracked + the 5
  global-only identified in §1.5.
- Around the 12, `~/.claude/skills/` also holds **~126 other entries** — `gstack` (owner's
  personal toolchain, ~113 sub-items), the `gsd-*` cluster (~60 May-2026 folders, third-party
  origin), and a handful of drwx------ single-owner directories from the recent gstack
  refresh (2026-08-15). See §3 for the full classification.
- The `install.sh` bulk-sync path is **hard-disabled** by an owner-authored guard
  (`install.sh:2-11`, in effect since 2026-07-20). The sanctioned publish path is
  `tools/skills/publish.sh <name>` — single-skill, owner-gated, backed-up, DB-preflighted.
- A working web control plane for publish exists: `POST /actions/skills/publish` +
  `GET /skills` + `GET /skills/:name/diff` + a `SkillsScreen` (`apps/web/src/screens/Skills.tsx`,
  279 lines). The Publish button is present but **currently disabled** pending the TouchID
  pause (`d-2026-08-09-001`); `POST /actions/skills/publish` is functional server-side
  (`apps/core/src/routes/actions.ts:1584`, spawner in `apps/core/src/actions/publish.ts`).
- **Provenance today is asymmetric**: everything under `skill/` in this repo has a full git
  history (author, timestamp, GSL key, commit message); the production copy under
  `~/.claude/skills/` has **only a filesystem mtime and nothing else** — no author, no
  reason, no diff, no way to answer "who changed this and why" after the fact. §5 walks
  that gap concretely.
- The registry that would remedy production-side provenance
  (`docs/skills/CHANGELOG.jsonl`, JSON-Schema-validated, appended by `publish.sh` via
  `record-publish.ts`) is **implemented but currently empty** (`wc -l → 0`) — every gosleep
  publish since the tooling landed has bypassed it, because the sanctioned trigger (owner
  clicks "Publish" or shells `publish.sh`) has not fired since. This is not a bug in the
  system, it is a symptom of the transition not being live yet.
- Plugins already exist on this machine (`~/.claude/plugins/installed_plugins.json` — 3
  installed: `context7`, `superpowers@6.2.0`, `nx`; 2 marketplaces registered:
  `claude-plugins-official`, `nx-claude-plugins`). We are not starting from zero on the
  plugins-hosting side.

---

## 1. Inventory of the 7 owned skills (`skill/<name>/`)

Measured 2026-08-15, `find skill/<name> -type f | xargs wc -l`.
"Purpose" = one-line paraphrase from the SKILL.md frontmatter `description:` field.
"Nature" = whether the skill is coupled to gosleep specifics (paths, ledgers, tmux workflow)
or is cross-project (works verbatim in any repo).

| # | Skill | Files | Total lines | Structure | Purpose | Nature |
|---|---|---|---|---|---|---|
| 1 | `orchestrating-delivery-agents` | 4 | 1497 | SKILL.md + `references/{lifecycle-and-edge-cases,re-wake-brief,worker-cycle-template}.md` | Coordinate delivery workers across a roadmap when work is too large for one agent's context (rewake, spawn/kill, lifecycle, owner steering at boundaries). | **cross-project in principle**, but currently laced with gosleep-specific ledger/heartbeat references. |
| 2 | `delivery-workflow` | 1 | 114 | SKILL.md only | Encode this team's delivery conventions: Epic+Task hierarchy, one PR per Epic, one commit per Task, tagged issue summaries, per-task `docs/dev_history` file. Builds on `using-jira`. | **cross-project** — the conventions are portable; only the "connect Jira workspace + GitHub repo on first use" is project-local state. |
| 3 | `handoff` | 1 | 125 | SKILL.md only | Write a dated handoff to `docs/handoff/` when pausing, running low on context, or crossing a phase/epic boundary. | **cross-project** — path is convention, easy to parametrize. |
| 4 | `using-jira` | 1 | 189 | SKILL.md only | Jira interaction conventions via Atlassian Rovo MCP: Epic+Task only (free tier), one PR per Epic, one commit per Task, GH issues mirror Jira. | **cross-project** — pure Jira etiquette. |
| 5 | `writing-prds` | 1 | 221 | SKILL.md only | Turn an idea/prompt/wish into a phase-structured PRD; evolve existing PRDs when scope grows. | **cross-project**. |
| 6 | `remote-control` | 1 | 100 | SKILL.md only | Reach a running Claude Code session from a phone — pair, approve permissions, decide whether overnight is trustworthy. | **cross-project**. |
| 7 | `tmux-agents-orchestration` | 1 | 201 | SKILL.md only | Practical tmux pane discipline for spawn/kill of teammate agents (session caps, cleanup, incident lessons). | **cross-project** — assumes tmux-driven orchestration but nothing project-local. |

Verbatim SKILL.md frontmatter for each is in
`skill/<name>/SKILL.md:1-6` (batched read earlier); reproduce with
`head -6 skill/<name>/SKILL.md`.

**Only one skill (`orchestrating-delivery-agents`) has a `references/` subtree**; the other
six are pure single-file SKILL.md skills.

**`skill/README.md`** (repo-local doc) enumerates the same 7 as "Owned skills" and
declares `skill/` the source of truth (`skill/README.md:1-17`).

### 1.5 Owner-authored skills that live ONLY globally (no repo copy)

Positively identified 2026-08-15 in response to the team-lead's scope-expansion mail. The
identification criteria used (in this order of decisiveness):

- **Frontmatter shape.** gstack skills carry `preamble-tier: N` + `version: X.Y.Z` +
  `triggers: - …` + `allowed-tools: - …` fields (verified on `~/.claude/skills/gstack/SKILL.md`,
  `spec`, `skillify`, `learn`). Owner-authored skills use the vanilla two-field
  frontmatter `name:` + `description:` only.
- **Description-tag suffix.** gstack skills end their `description:` with `(gstack)`.
- **Prose style.** Owner-authored skills carry Russian trigger phrases inline (e.g.
  `"прогнать сценарий"`, `"проверка после реализации"`), the "owner" as a first-class actor,
  and a decision-first framing ("the skill decides ONE question").
- **Project references.** Direct mentions of `gosleep`, `tasty-lunch`, `GSL-N` keys, or
  Russian owner rules.
- **`gsd-*` prefix** → third-party GSD suite (bulk-installed 2026-05-24).
- **Missing from disk anywhere else** → global-only; not in gosleep repo, not in gstack
  install root.

**Result:** 5 owner-authored global-only skills. Each fails at least one gstack criterion,
matches owner-authorship signals, and has zero dev copy anywhere in the gosleep repo tree
(`find . -name SKILL.md | grep <name>` returns nothing for any of them). No other entries
under `~/.claude/skills/` passed the criteria — the fleet size is 12 (7 tracked + 5 orphan).

| # | Skill | Files | SKILL.md size | Mtime (global) | Purpose (paraphrased from frontmatter) | Nature | Evidence anchor |
|---|---|---|---|---|---|---|---|
| 8 | `agentic-report-creator` | SKILL.md + `references/` (5 files: `demo.html`, `design-tokens.md`, `example-payload.json`, `i18n-workflow.md`, `rendering.md`) + `templates/` | 23425 B | Jul 16, 2026 | Turn a structured JSON findings payload into a self-contained HTML dashboard report (Vercel/Linear aesthetic, light + dark themes, English primary + Russian shell, lightbox screenshots, integer-numbered items each naming a Jira ticket). Zero deps, offline-openable. | **cross-project** — nothing gosleep-specific in the SKILL.md body (grep `gosleep\|GSL-\|tasty-lunch → 0`); consumed by `verifier-skeptic` per its frontmatter. | Frontmatter `description:` mentions "Russian translation shell", "Jira ticket". Owner-style prose. Not gstack. |
| 9 | `agentic-scenario-runner` | SKILL.md + `references/` (1 file: **`case-tasty-lunch-01.md`**) | 25013 B | Jul 28, 2026 | Decide whether to run runs/samples/evals for an AI agent BEFORE spending API calls or agent-hours. Trigger set is bilingual ("прогнать сценарий", "run the scenario", "eval", "model sweep"). | **cross-project** — the reference case-study points at owner's other project (tasty-lunch), which is proof of authorship, not gosleep-specific coupling. | `references/case-tasty-lunch-01.md` = decisive evidence of owner authorship (tasty-lunch is owner's other project). Russian triggers. Not gstack. |
| 10 | `efficient-agent-evals` | SKILL.md only | 4917 B | **Jun 9, 2026 (oldest of the 5)** | Keep the same eval signal at a fraction of the agents and tokens when a behavioral eval was about to launch a huge fan-out. | **cross-project** — evaluation methodology, no project coupling. | Owner-style opt-in framing ("Use when …"). Not gstack. No `preamble-tier`. |
| 11 | `extra-usage` | SKILL.md only | 5824 B | Jun 14, 2026 | Opt-in session modifier: "the owner opts into spending at maximum" — lifts token-economy rails (Sonnet-verification, Workflow tool, fan-out caps, budget/loop-guard) while leaving safety rails intact. | **cross-project** — refers to gosleep's specific `Workflow` and `ultracode` tooling metaphors, but conceptually portable. | Explicit "owner" mention. Not gstack. |
| 12 | `verifier-skeptic` | SKILL.md + `references/` (3 files: `findings-schema.md`, `jira-recipes.md`, `pixel-perfect-loop.md`) | 31564 B (**largest**) | Jul 16, 2026 | Adversarial verifier for a shipped Jira Epic against its design source of truth (three lanes: architecture, functionality, design). Files every finding as a numbered Jira Task labeled `verifier` for a fix agent, and emits an HTML dashboard via `agentic-report-creator`. READ-ONLY. INDEPENDENT (never reads prior audits). | **cross-project in principle**, but heavily coupled to GSL Jira conventions (Task labeled `verifier`, Epic + Task hierarchy — matches gosleep's Epic+Task-only free-tier rule). | Direct "Jira Epic" + "Task labeled `verifier`" + Russian "проверка после реализации / аудит эпика" — owner-authored, gosleep-adjacent. Not gstack. |

**Provenance state of the 5 (worst-of-fleet):**

- **`skill/` copy:** absent for all 5 (`ls skill/ | grep -E 'agentic|efficient|extra|verifier' → nothing`).
- **git history for these 5 anywhere in this repo:** none. They were never vendored.
- **Backup elsewhere on the machine:** unknown to this report. `~/.claude/skills/<name>/`
  is the sole known copy. **A single `rm -rf` deletes any of the 5 forever.**
- **Combined bytes of SKILL.md alone:** ~91 KB across the 5 (plus references + templates
  for the three that have them). Total `du -sh` on the five dirs is a worthwhile
  next-step measurement.

**Migration implication:** the 5 need to be reverse-synced into the repo BEFORE any
plugin packaging work, on the same terms as GSL-251 handled the 7 (owner-sanctioned,
one-off reverse-sync, then commit). Then they participate in whichever packaging option
§7.1 lands on.

**Uncertain — flag for owner:**

- Are there OTHER owner-authored skills the owner has forgotten? This inventory searched
  the 138 entries under `~/.claude/skills/` and found exactly these 5 that (a) fail all
  gstack criteria, (b) are not `gsd-*`, (c) look owner-authored by prose style. If the
  owner recalls any that don't appear on this list, that gap needs closing before the
  migration decision.
- `verifier-skeptic`'s references live only under `~/.claude/skills/verifier-skeptic/references/`.
  Is `pixel-perfect-loop.md` documented anywhere in the gosleep repo? A grep of the repo
  turns up nothing. Reverse-sync must include the full subtree, not just the SKILL.md.
- Extension of the `changelog.schema.json` skill enum (§3.4) — the current schema at
  `tools/skills/schema/changelog.schema.json:18-26` closes the `skill` enum to the 7 known
  names. If the 5 orphans get reverse-synced and become tracked, the enum must be extended
  additively to 12. This is a one-line schema edit + validator regeneration.

---

## 2. Global copies + drift verification

### 2.1 What of ours exists globally

All 7 owned skills exist under `~/.claude/skills/<name>/`:

```
$ for s in orchestrating-delivery-agents delivery-workflow handoff using-jira \
           writing-prds remote-control tmux-agents-orchestration; do
    stat -f '%Sm %N' "$HOME/.claude/skills/$s/SKILL.md"
  done
orchestrating-delivery-agents: Aug  3 12:51:18 2026 …/orchestrating-delivery-agents/SKILL.md
delivery-workflow:             Jul  1 15:33:30 2026 …/delivery-workflow/SKILL.md
handoff:                       Jul 13 07:28:37 2026 …/handoff/SKILL.md
using-jira:                    Jul 14 18:28:27 2026 …/using-jira/SKILL.md
writing-prds:                  Jul  1 15:33:30 2026 …/writing-prds/SKILL.md
remote-control:                Jul 20 15:08:50 2026 …/remote-control/SKILL.md
tmux-agents-orchestration:     Jul 13 19:16:11 2026 …/tmux-agents-orchestration/SKILL.md
```

### 2.2 Drift after the GSL-251 reverse-sync

```
$ for s in orchestrating-delivery-agents delivery-workflow handoff using-jira \
           writing-prds remote-control tmux-agents-orchestration; do
    diff -rq "skill/$s/" "$HOME/.claude/skills/$s/" 2>&1 | grep -v '\.DS_Store'
  done
(no output — all seven directories are byte-equal)
```

Reverse-sync commit that made this true: `db30235 GSL-251 [Skill][Process] Reverse-sync O1: local
skill/ caught up from global (7 skills)` (`git log --oneline -1`).

**Consequence:** for the next migration decision, `skill/` is a **complete, authoritative snapshot**
of the production surface. Whatever we design can be evaluated against `skill/` alone; the
global copy is currently redundant.

### 2.3 What ELSE lives under `~/.claude/skills/`

Raw `ls -la ~/.claude/skills/` inspected; here is the classification. **~138 entries total**
(minus `.`, `..`, `.DS_Store`).

| Bucket | Count | Examples | Origin |
|---|---|---|---|
| **Owned — tracked in `skill/`** | 7 | the seven listed in §1 | owned by gosleep repo (source of truth `skill/`). |
| **Owned — global-only, no repo copy** | 5 | `agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic` — see §1.5 for full inventory + evidence. | owner-authored on-disk originals; no dev copy anywhere in the repo tree. Full reverse-sync required before packaging. |
| **`gstack` toolchain** | 1 top folder + ~55 sibling skill folders (`autoplan`, `browse`, `spec`, `ship`, `skillify`, `learn`, `qa`, `plan-*-review`, `ios-*`, `design-*`, `land-and-deploy`, `investigate`, `_gstack-command`, `gstack-upgrade`, `open-gstack-browser`, `pair-agent`, `setup-*`, `context-*`, `sync-gbrain`, etc.) | frontmatter shape `preamble-tier: N` + `version: X.Y.Z` + `triggers:` + `allowed-tools:`; description usually suffixed `(gstack)`. Global `CLAUDE.md` declares `gstack is installed globally at ~/.claude/skills/gstack. Run /gstack-upgrade to keep it current.` | **third-party** — owner's personal toolchain, versioned & upgraded by `/gstack-upgrade`. Not gosleep's. Out of migration scope. |
| **`gsd-*` cluster** | ~60 folders (`gsd-add-tests`, `gsd-audit-*`, `gsd-code-review`, `gsd-debug`, `gsd-execute-phase`, `gsd-plan-phase`, `gsd-ui-*`, `gsd-workspace`, `gsd-workstreams`, etc.) | all dated `24 трав. 19:03` (May 24, 2026 — bulk install) | **third-party** — the GSD (Get Shit Done) framework. Not gosleep's. Out of migration scope. |

**Bottom line:** **~126 of the 138 global entries are OUTSIDE gosleep's scope**. The migration
covers **12 owner-authored skills** = 7 (in `skill/`) + 5 (global-only, §1.5). Nothing
about a plugin-based future should touch `gstack`, the `gsd-*` cluster, or the third-party
marketplace-installed plugins living under `~/.claude/plugins/cache/…`.

### 2.4 Marketplaces + plugins already live on this machine

Not empty. Owner is already running Claude Code plugins.

```
$ cat ~/.claude/plugins/installed_plugins.json
{
  "version": 2,
  "plugins": {
    "context7@claude-plugins-official":    [{ "version": "unknown", "installedAt": "2026-04-19", "gitCommitSha": "30a213f9…" }],
    "superpowers@claude-plugins-official": [{ "version": "6.2.0",   "installedAt": "2026-04-19", "lastUpdated": "2026-07-24", "gitCommitSha": "b5576485…" }],
    "nx@nx-claude-plugins":                [{ "version": "0.2.34",  "installedAt": "2026-05-23", "scope": "project" }]
  }
}
$ ls ~/.claude/plugins/marketplaces
claude-plugins-official   nx-claude-plugins
```

So the plugin surface (installed_plugins.json with `version` + `gitCommitSha` + `installedAt` +
`lastUpdated`) **already exists on disk** and already tracks the four things we lack for skills
(name, version, git sha, install time). §7 uses this as the anchor for requirement 1.

---

## 3. Current tooling and process

### 3.1 `install.sh` — hard-disabled at the top

`install.sh:1-11` (verbatim):

```bash
#!/usr/bin/env bash
# ⛔⛔⛔ ЗАЩИТА — СКРИПТ ВРЕМЕННО ОТКЛЮЧЁН (owner, 2026-07-20) ⛔⛔⛔
# Агенты могут случайно вызвать install.sh и перезаписать ГЛОБАЛЬНЫЕ скиллы
# (~/.claude/skills/*, в т.ч. orchestrating-delivery-agents — авторитетна ГЛОБАЛЬНАЯ копия,
# в локальной skill/ есть проблемы). …
echo "install.sh: ⛔ ЗАЩИТА ВКЛЮЧЕНА — sync local→global отключён владельцем 2026-07-20 …" >&2
exit 1
```

The rest of the file (`install.sh:12-44`) is the dormant `for skill_dir in "${SKILLS_SRC}"/*/`
loop that would bulk-rsync. It is unreachable — the `exit 1` blocks it.

**Rule from `CLAUDE.md`:** `./install.sh` целиком **ЗАПРЕЩЁН** for agents (owner 2026-07-20).
Only pointwise `rsync -a skill/<name>/ ~/.claude/skills/<name>/` is allowed for individual
skills, and even that never for `orchestrating-delivery-agents` without explicit owner
sanction (recorded in memory `gosleep-owns-all-delivery-skills.md`).

### 3.2 `tools/skills/publish.sh` — the ONE sanctioned publish path

`tools/skills/publish.sh:1-38` (header): declares itself "THE ONLY SANCTIONED PATH from
development to production" and lists **four defense layers**:

1. `CLAUDE.md` prose rule (agents forbidden to touch `~/.claude/skills/`).
2. This file — owner-gate + backup + single-skill discipline.
3. Production test-guard (`tools/lab/smoke.sh`, T10).
4. `install.sh` guard (already on since 2026-07-20).

What `publish.sh` does end-to-end (map from `publish.sh:56-309`):

| Stage | Line range | Behavior |
|---|---|---|
| Arg parse + refuse `--all`/globs/path-traversal/`--*`-shaped names | 80-134 | Hard refusals — exit code 2. |
| Refuse if `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` set | 144-148 | Belt-and-braces — exit 3. |
| **Owner gate:** stdin `isatty(0)` OR `GOSLEEP_WEB_TOKEN` ≥16 bytes | 150-163 | Both fail → exit 3. TTY = owner in a terminal; env-nonce = web endpoint spawn. |
| Run `verify-local.sh` (pre-publish sanity) | 165-173 | Fail → exit 1. |
| DB preflight (`bun run apps/core/scripts/record-publish.ts check`) | 175-194 | Fail → exit 1, **nothing on disk changed**. |
| Print diff (informational) | 196-212 | ≤200 lines; the real gate is verify + backup. |
| **Interactive TTY confirm** (`type 'yes'`) unless `--yes` or env-only | 214-245 | TouchID leg PAUSED (`d-2026-08-09-001`); TODO(GSL-288) to swap in the TouchID .app once the pause lifts. |
| **Pre-rsync backup** to `docs/skills/backups/<name>-<ts>/` | 247-261 | Every publish is reversible. |
| `rsync -a --delete skill/<name>/ ~/.claude/skills/<name>/` | 263-271 | On failure → attempt restore from backup. |
| Append CHANGELOG row via `bun apps/core/scripts/record-publish.ts write …` | 273-298 | Rsync landed before this; failure prints the exact restore command. |
| Emit JSON summary on stdout (`{"event":"skills.publish.done",…}`) | 302-309 | Consumed by the web endpoint spawner (§3.5). |

Exit-code contract (line 33-38): `0` = success; `1` = error mid-flight; `2` = usage;
`3` = owner gate refused.

### 3.3 `tools/skills/verify-local.sh` — sanity check

`tools/skills/verify-local.sh:1-158`. Four checks: (1) skill dir exists, (2) `SKILL.md`
present + non-empty, (3) every file under `references/` is readable, (4) `git status
--porcelain skill/<name>` is empty (opt out with `SKIP_GIT_CHECK=1`). Conservative by
design (`verify-local.sh:22-27`) — false-positive-cheap, false-negative-expensive.

### 3.4 `tools/skills/validate-changelog.sh` + `schema/changelog.schema.json`

- `tools/skills/validate-changelog.sh:1-187` — walks `docs/skills/CHANGELOG.jsonl` line by
  line, validates each row against a Python-embedded copy of the JSON Schema. Empty file
  is a valid empty registry (exit 0). Written in bash+python3 so a fresh clone can run it
  with no npm/pip dependency.
- `tools/skills/schema/changelog.schema.json:1-62` — draft-07. Required fields:
  `ts` (ISO-8601 UTC), `skill` (enum of the seven listed in §1),
  `task` (`^GSL-\d+$`), `commit` (40-char lowercase git SHA), `lesson` (≤4096 chars),
  `status` (`draft|reviewed|published`). Optional `intent_id`
  (correlates a filesystem mutation to a legitimate web-endpoint publish).
- The `skill` enum on `schema/changelog.schema.json:18-26` is closed to **exactly the 7
  owned names** — adding a new skill is an additive schema change.

### 3.5 Web control plane wiring (already shipped)

- **Route** — `apps/core/src/routes/actions.ts:1565-1620` — `POST /actions/skills/publish`.
  Bearer-gated. Body `{ skill, lesson?, task? }`. Skill name shape validated
  (`^[a-z0-9][a-z0-9-]{0,63}$`). Three-layer envelope: `requireBearer` → `serialize(…)` per-endpoint
  mutex → `withTimeline(…)` idempotency ledger (repeat POST with same `Idempotency-Key`
  returns the cached original result).
- **Spawner** — `apps/core/src/actions/publish.ts` (158 lines) — mints a per-request
  `GOSLEEP_WEB_TOKEN` nonce, spawns `tools/skills/publish.sh <name>`, captures the JSON
  summary the CLI prints on stdout, propagates to the endpoint result.
- **Read APIs** — `apps/core/src/routes/read.ts:218-274` `GET /skills` (registry list,
  filesystem-hash enriched); `read.ts:278-…` `GET /skills/:name/diff` (full diff for the
  details drawer).
- **DB schema** — `apps/core/src/db/schema.ts:143` `skills` table (name, version, status,
  last_published_at, last_published_by, changelog).
- **DB writer** — `apps/core/scripts/record-publish.ts` (393 lines). Modes: `check`
  (used by `publish.sh` preflight) and `write` (append CHANGELOG row + upsert `skills` row).
- **Diff engine** — `apps/core/src/skills/diff.ts` (263 lines). Exports `computeSkillDiff`
  + `quickHasChanges` + `KNOWN_SKILLS`.
- **UI** — `apps/web/src/screens/Skills.tsx` (279 lines) + `apps/web/src/router.tsx:37`
  wires `/skills` to `SkillsScreen` (previously fell through to `NotFoundScreen`, GSL-295).
  `apps/web/src/components/AppShell.tsx:36` adds the nav item.
- **Publish button** — visible on every row with `has_changes === true`, **DISABLED
  tonight** per `d-2026-08-09-001` (TouchID pause). Tooltip points at the CLI equivalent
  (`bash tools/skills/publish.sh <name>`). Flipping the disabled flag is a one-line
  change when the pause lifts (`Skills.tsx:6-12`).

### 3.6 `CLAUDE.md` safety rules

Reproduce verbatim (project `CLAUDE.md`, "Safety rules" block, quoted in the system
context):

- **2026-07-20 (owner): `orchestrating-delivery-agents` — authoritative copy is GLOBAL**
  (`~/.claude/skills/orchestrating-delivery-agents/`); local `skill/` has issues. Never
  overwrite global automatically: don't run `./install.sh` (agent or hook); install
  individual skills only with pointwise `rsync -a skill/<name>/ ~/.claude/skills/<name>/`;
  **never** `orchestrating-delivery-agents` without explicit owner direction.
- `--delete` is scoped to individual named skill dirs (`~/.claude/skills/<name>/`).
- The script NEVER runs `rsync --delete` or `rm` against the parent `~/.claude/skills/`.
- Unrelated global skills (`gstack`, `gsd-*`, plugins, etc.) are never touched.

Editing a skill is a **shift-closing item** (`GSL-189`) — the shift-closing agent must
(a) skim for a lesson, (b) if one exists, file a `[Skill]`-tagged GSL Task and publish via
`tools/skills/publish.sh <name>` (never bypass), (c) link the lesson in the handoff's
"Comments". Silence must be explicit ("no skill lessons this shift").

---

## 4. Provenance / versioning today

**This is where the owner's pain lives.** The two sides are structurally different.

### 4.1 `skill/<name>/` — full git history

`git log --oneline -- skill/` (top 5 relevant):

```
db30235 GSL-251 [Skill][Process] Reverse-sync O1: local skill/ caught up from global (7 skills)
f9c2993 GSL-254 [Tooling][Skill] publish.sh DB preflight (verifier M1 fix).
982e359 GSL-189 [Docs][Process] Shift-closing checklist for skill edits (T9).
29c2e55 GSL-186 [Skill] handoff path + wiki + dev_history filename (T8).
eebc33e GSL-104 [Skill][Docs] Remote Control: swappable обёртка + runbook пэйринга + …
```

Per-skill first-touch anchor (`git log -1 … -- skill/<name>/`):

- `orchestrating-delivery-agents` → last touched by `db30235` (2026-08-10, reverse-sync).
- `delivery-workflow` / `handoff` / `writing-prds` / `using-jira` → last touched by
  `db30235` (2026-08-10, reverse-sync); original vendor commit for the first four was
  `73e5a5c GSL-17 Vendor writing-prds, delivery-workflow, handoff, using-jira into the repo`
  (2026-06-28).
- `remote-control` → last touched by `eebc33e GSL-104` (2026-07-20).
- `tmux-agents-orchestration` → **only touched once ever**, by `db30235 GSL-251`
  (2026-08-10). Governance plan §3 explicitly noted this skill was **absent from git
  before GSL-251**: `git log --oneline --all -- 'skill/tmux-agents-orchestration/**' | wc -l → 1`.

Every commit carries the author (Git user `R` from git status), the timestamp, the GSL
key, and a human message. Full trail.

### 4.2 `~/.claude/skills/<name>/` — mtimes and nothing else

```
$ stat -f '%Sm %N' ~/.claude/skills/using-jira/SKILL.md
Jul 14 18:28:27 2026 …/using-jira/SKILL.md
```

That is **the total available provenance**. No author. No reason. No diff. No commit sha.
No way to answer:

- Who added the "ATLASSIAN_API_TOKEN" lesson? When? Why?
- Did the `orchestrating-delivery-agents` "roll trigger" paragraph change last month?
- If I want to roll back today's edit to `using-jira`, which state do I roll back to?

Governance plan §3.1 measured, on 2026-08-03: `orchestrating-delivery-agents` had drifted
**+21/−12 lines** and `using-jira` **+16/−0 lines** between local and global — with
**zero explanation** on the production side of who added the extra lines, or when, or in
service of what. The GSL-251 reverse-sync closed the drift by copying global's state into
git and preserving it there; without that one commit, those diffs would still be untracked
today.

### 4.3 `docs/skills/CHANGELOG.jsonl` — implemented, currently empty

```
$ wc -l docs/skills/CHANGELOG.jsonl
0
```

The registry that would have to hold every future publish record is present + validated,
but has zero rows in it — because the publish path has not been exercised end-to-end
since the tooling landed. Once `publish.sh` runs against a real edit + owner confirm,
`record-publish.ts write` appends the row: `{ts, skill, task, commit, lesson, status,
intent_id}`.

**Punchline for the owner's pain:** the registry is **the mechanism that would replace
"mtime and nothing else" with a real audit trail** — but it is empty. Until either
(a) we start exercising `publish.sh` on live edits, or (b) we move to plugins where the
version + git sha are ambient (as `installed_plugins.json` already shows for
`superpowers@6.2.0`), the pain is unaddressed in production.

---

## 5. Owner constraints in force

From the mission brief + `docs/reports/skills-management-plan-2026-08-10/plan.md` §1.5:

1. **`d-2026-07-20`** — global copies of skills are authoritative; `install.sh` guard on;
   reverse-sync only on explicit owner command; `orchestrating-delivery-agents` **never**
   auto-synced. This is the "safety inversion" that shapes everything.
2. **`d-2026-08-03-003`** — governance plan §7 (7 stages) approved by the owner. That plan
   is `docs/plans/skills-governance-plan.md` (Russian, 144 lines) with the English mirror at
   `docs/prd/02-phase8-skills-management.md`.
3. **`d-2026-08-09-001`** — TouchID + Keychain PAUSED. The `apps/core/bin/touchid-gate.app`
   exists but no code path invokes it; the TTY-confirm + env-nonce path is the interim.
4. **`d-2026-08-09-005`** — night-autonomy session for the initial build; the current
   research session inherits owner-approval-only for any behaviour change to the skills
   surface.
5. **Owner's new constraints for this migration** (from the mission brief, treat as
   hard):
   - (a) Any transition happens **only with owner approval**. Nothing changed unilaterally.
   - (b) **Soft transition** — skills and plugins **coexist during migration**; skills
     keep working while plugins ramp up. The decision about retiring legacy skills comes
     **only AFTER full transition**, both globally and in gosleep.

---

## 6. Requirements derivation for the target system

Derived from §4 (the pain) + §5 (the constraints) + §3 (what we already invested in).

### R1. Per-artifact versioning

Every "skill" (whatever it is packaged as) must carry an **explicit version** on disk. Not
mtime, not "the latest commit that touched some file" — a version field the harness
records at install and shows to the owner in the Skills screen. Precedent already exists on
this machine (`installed_plugins.json` records `superpowers@6.2.0`, `nx@0.2.34`).

**Granularity question (open):** version-per-skill (7 versions), version-per-thematic-bundle
(e.g. delivery-bundle vs orchestration-bundle, 2-3 versions), or version-per-repo
(one gosleep-skills version). §7 sketches the tradeoffs.

### R2. Full provenance per install/update

For every version installed at `~/.claude/skills/`-equivalent, the harness (or our own
registry) must be able to answer:

- who authored the change (git author);
- when it landed (ts);
- why (commit message + optional `lesson` free-text);
- what changed (diff vs previous version).

**`docs/skills/CHANGELOG.jsonl`** already models (ts, skill, task, commit, lesson, status,
intent_id) — we can reuse the field set verbatim. Under plugins, most of those come from
the plugin manifest + git for free; `lesson` (root-cause "why") is our contribution and
would need a place to live in a plugin bundle (see §7).

### R3. Review-gated publish (owner approves; agents cannot bypass)

The four-layer defense (`CLAUDE.md` rule → `publish.sh` owner-gate → production
test-guard → `install.sh` guard) must translate to the target system. Under plugins the
equivalents are: (a) `CLAUDE.md` still forbids direct writes to `~/.claude/plugins/…`;
(b) plugin install/update is owner-invoked (marketplace `install`/`update` slash command);
(c) plugin manifests are signed / registered via marketplace catalog rather than local
rsync; (d) the harness plugin cache lives in `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
and is content-addressed by `gitCommitSha` — hard to spoof by an in-session agent because
the agent doesn't get to write outside the cache path. The four-layer intent maps 1:1;
the mechanics change.

### R4. Distribution to BOTH global (cross-project) and gosleep-project scope

`installed_plugins.json` already distinguishes `scope: "user"` (global — like `context7`
and `superpowers`) vs `scope: "project"` with `projectPath` (like `nx` bound to
`agentic-flow-admin`). The seven owned skills are cross-project by nature (§1 "Nature"
column), so **most or all of them land at `scope: "user"`**. If some later thematic
bundle is gosleep-specific (e.g. the lab-emit + heartbeat wiring that
`orchestrating-delivery-agents` currently references), that bundle would go
`scope: "project"` bound to the gosleep repo.

### R5. Soft-coexistence during migration

Skills under `~/.claude/skills/<name>/` and plugins under
`~/.claude/plugins/cache/…/<name>/<version>/` must both load. Claude Code's discovery
already merges both: the skill listing in the system prompt for the current session shows
`gstack` (a `~/.claude/skills/gstack/` entry), the seven owned skills, AND
`superpowers:*` (a plugin — note the `superpowers:` prefix). So the harness natively
supports coexistence — we don't need to solve it, we just need to **not disable the skill
loader while we build the plugin path**. The `install.sh` guard already prevents accidental
writes to the skill dirs; the invariant "skill still works if plugin absent" is a matter
of not deleting `~/.claude/skills/<name>/` prematurely. That deletion is the last step
the owner authorizes AFTER acceptance.

### R6. Harness-of-choice claim ("harness uses plugins, not loose skills")

If our new stance is that a serious harness ships as a plugin (or plugins) rather than as
loose skill dirs, then:

- **gosleep as harness** — the seven owned skills become a `gosleep-harness` plugin (or
  bundle of plugins). The web control plane at `apps/web/` gains an area that lists
  installed harness plugins with their versions + provenance, mirrored from
  `~/.claude/plugins/installed_plugins.json` + the marketplace's per-plugin manifest.
  (Note only — this is not a design.)
- **The current `SkillsScreen` at `apps/web/src/screens/Skills.tsx`** is not wasted;
  it becomes the "installed plugins for this machine" surface, reading either from the
  plugin registry or from a proxy the core exposes over `GET /plugins`.

### R7. Marketplace / distribution channel

The plugin model requires a marketplace catalog (see the machine's registered
marketplaces: `claude-plugins-official`, `nx-claude-plugins`). We need to decide where our
plugin(s) get catalogued. Options in §7.

### R8. The registry we've built (§3.4-3.5) does NOT go to waste

The `changelog.schema.json`, `validate-changelog.sh`, `docs/skills/CHANGELOG.jsonl`,
`docs/skills/backups/`, and `record-publish.ts` were built to give production its own audit
trail. Under plugins the audit surface migrates to the marketplace catalog + Claude Code's
own installed_plugins.json, but the same **fields** (ts, task, commit, lesson) remain valid
for gosleep's internal audit — plugin releases still need to point back to a GSL task.
We can either (a) keep the JSONL as a gosleep-side release ledger even under plugins,
or (b) fold it into a marketplace `releases.jsonl` per plugin. §7 open question.

---

## 7. Fit / gap sketch (not the final design)

### 7.1 Packaging options

| Option | Shape | Pros | Cons | Complexity |
|---|---|---|---|---|
| **A. One plugin bundling all 7 skills** | `gosleep-harness` marketplace plugin containing seven `skills/<name>/SKILL.md` files | One version to reason about; one release cadence; one catalog entry. Matches the fact that all 7 are owned by one repo and evolve together in practice. | Coarse-grained rollback: rolling back one skill's regression means rolling back the whole bundle. Every skill edit bumps the whole plugin's version — noisy for owner. | Low. |
| **B. Thematic plugin bundles** | e.g. `gosleep-delivery` (`delivery-workflow` + `using-jira` + `writing-prds` + `handoff`), `gosleep-orchestration` (`orchestrating-delivery-agents` + `tmux-agents-orchestration`), `gosleep-remote` (`remote-control`) | Coherent groupings map to how the owner mentally uses them. Rollback is scoped to a group. Cross-project users could install just the delivery bundle without the orchestration/tmux baggage. | Two-three release cadences to maintain. Someone has to draw the lines authoritatively. | Medium. |
| **C. Per-skill plugins** | Seven separately versioned plugins. | Finest-grained versioning + rollback. Matches R1 taken to the limit. | Seven catalog entries, seven install commands to bootstrap a fresh machine, seven changelog trails to correlate. Overhead high given the small population and single-owner evolution. | High. |

**Initial lean (subjective):** B looks most defensible against the owner's stated pain
(versioning + provenance) without over-fragmenting. But this is precisely the kind of
decision the owner wants to make explicitly, so §8 keeps it as an open question.

### 7.2 Where does the marketplace repo live?

Options:

- **In this repo** — a `plugins/` directory at the gosleep root exports one or more plugin
  bundles, and gosleep itself acts as its own marketplace. Simplest bootstrap; keeps the
  seven skills next to the code that references them (e.g. `orchestrating-delivery-agents`
  cites `apps/core/scripts/*` in its live use). Cost: every gosleep contributor's clone
  becomes a marketplace host — probably fine for a single-owner project, unusual for a
  shared one.
- **Dedicated private repo** (`ainstance-labs/gosleep-plugins` or similar) — cleaner
  separation between "harness code that runs" (gosleep) and "harness plugins other
  machines install" (plugins repo). Cost: two repos to keep in lockstep during the
  migration; extra CI to publish from gosleep to plugins.
- **Contribute to `claude-plugins-official`** — the marketplace already installed on this
  machine. Cost: submitting anything external means the owner's private conventions
  (Jira/GH mirror rules, per-task dev_history files) leak into a public catalog — probably
  not the right home for these 7 skills.

**Initial lean (subjective):** dedicated private repo (`gosleep-plugins`), because it
matches the "harness uses plugins" story cleanly and mirrors how `nx@nx-claude-plugins`
is packaged (own marketplace, own repo). But this is also owner's call.

### 7.3 What happens to `publish.sh` + `record-publish.ts` + `CHANGELOG.jsonl` under plugins?

The current publish flow is essentially a **hand-rolled miniature marketplace** — with an
owner-gate, a backup, a diff, a JSONL registry, and idempotency. Under plugins:

- `publish.sh` **retires** in the "sync local → global" role — plugin install is
  Claude Code's job, not a bash rsync. What remains valuable is the **owner-gate** part
  (TTY + optional TouchID + env-nonce). That could reappear as an owner-gated "release"
  script in the plugin repo (bump manifest version, tag, push), because the equivalent
  question — "did the owner authorize this release?" — is still worth asking.
- `record-publish.ts` **partially retires**. The `check` mode (DB preflight for the
  `skills` table) becomes moot if we stop maintaining our own registry. The `write` mode
  reappears as a marketplace-side "record a release" if we keep a gosleep-internal audit
  trail alongside the marketplace catalog (R8).
- `docs/skills/CHANGELOG.jsonl` — either (a) keep it as gosleep's release ledger even
  under plugins (the schema is proven, one row per release is cheap), or (b) let it
  retire once every entry is instead readable in the marketplace's own release manifest
  per plugin. Owner call.
- `apps/web/src/screens/Skills.tsx` **evolves** rather than retires: it becomes the
  "installed harness plugins" view, driven by a new core endpoint that reads
  `~/.claude/plugins/installed_plugins.json` (or a marketplace API) instead of our own
  `skills` DB table. The disabled Publish button becomes moot (installation is a slash
  command, not a browser click), but the "diff / changelog / provenance" surface stays
  useful.

**The four-layer defense** re-maps:

| Layer today | Layer under plugins |
|---|---|
| 1. `CLAUDE.md` rule: agents forbidden to touch `~/.claude/skills/` | 1. `CLAUDE.md` rule extended: agents forbidden to touch `~/.claude/plugins/…` and the plugin cache. |
| 2. `publish.sh` owner-gate | 2. Owner-only marketplace `install`/`update` (Claude Code slash commands) + our own release-gate script for the plugin repo. |
| 3. Production test-guard (`tools/lab/smoke.sh` T10) | 3. Extend the same test-guard to also watch `~/.claude/plugins/cache/…` for unsanctioned mutations. |
| 4. `install.sh` guard (permanently on) | 4. Same guard stays (skills coexistence, R5) — plus refuse to hand-mutate the plugin cache from bash. |

### 7.4 Fit / gap headline

**Fit — high**:

- Our 7 skills are already SKILL.md-based (native to Claude Code's plugin surface — plugins
  ship skills too, cf. `gstack` and `superpowers:*` which appear alongside our skills in
  the session prompt).
- We already have a working owner-gate + audit-trail model (`publish.sh` +
  `record-publish.ts` + JSONL registry). The concepts translate.
- We already run plugins on this machine (`installed_plugins.json`, two marketplaces
  registered). No infra bootstrap.
- Skills + plugins coexist natively in Claude Code's discovery loop — the soft-transition
  constraint (R5) is a matter of not deleting our skill dirs prematurely.

**Gap — real but bounded**:

- No plugin manifest format documented in this report — the "plugins world" companion
  half from res-plug covers that.
- No signing / release / catalog format documented here — same.
- The `lesson` free-text field (root-cause "why") that our JSONL carries has no obvious
  home in a stock plugin manifest — either we invent a `lessons.jsonl` alongside the
  plugin, or the lesson goes only into the git commit + our internal release ledger.
- `orchestrating-delivery-agents` (§1) contains gosleep-specific references (ledger paths,
  heartbeat wiring). Cross-project shipping requires a light audit to parametrize or
  remove those.
- `tmux-agents-orchestration` was born in production and only entered git 2026-08-10 — its
  test coverage is thin.

---

## 8. Open questions for the owner

1. **Packaging granularity** — Option A (one plugin), Option B (2-3 thematic bundles),
   or Option C (per-skill)? §7.1. Recommendation is B, but the choice shapes everything
   downstream.
2. **Marketplace location** — `plugins/` inside gosleep, a dedicated private
   `gosleep-plugins` repo, or contribute to `claude-plugins-official`? §7.2.
   Recommendation is dedicated private repo.
3. **Fate of `docs/skills/CHANGELOG.jsonl`** — keep as gosleep's release ledger under
   plugins, or retire once the marketplace catalog covers the same fields? §7.3 / R8.
4. **Does `orchestrating-delivery-agents` ship as a portable plugin or stay
   gosleep-project-local?** — its content currently references gosleep-specific ledger
   paths (`docs/lab/*.jsonl`, heartbeat wiring). Either strip those or ship it as a
   `scope: "project"` plugin bound to gosleep. §7.4 gap 4.
5. **The 5 global-only owner-authored skills (§1.5)** are IN SCOPE (owner-confirmed
   2026-08-15). Three sub-questions the owner must answer before we act on them:
   (a) Does the owner recall any OTHER global-only skills that this report missed? The
   inventory examined all 138 entries and found exactly 5 that meet owner-authorship
   signals + fail every gstack criterion; if the count feels wrong, we need to widen the
   search.
   (b) Should the reverse-sync land BEFORE any packaging design work (mirror of the
   GSL-251 pattern for the 7), or bundled into the first plugin release?
   (c) Do the 5 fold into the same plugin bundle(s) as the 7, or do
   `agentic-report-creator` + `verifier-skeptic` + `agentic-scenario-runner` +
   `efficient-agent-evals` group as their own "evals-and-audits" bundle distinct from
   the delivery/orchestration bundles?
6. **Timing** — kick off the plugin skeleton (one bundle, all 12 skills after the 5 are
   reverse-synced, private repo, no publish path yet) NOW while `publish.sh` remains the
   sanctioned production write path, and take the parallel-run soft-transition tour of
   duty? Or stabilize the current publish path (exercise it on the next real skill lesson
   to populate the JSONL) before starting?

---

## Appendix — commands to reproduce

```
# Inventory
for s in orchestrating-delivery-agents delivery-workflow handoff using-jira \
         writing-prds remote-control tmux-agents-orchestration; do
  echo "=== $s ==="
  find "skill/$s" -type f -not -name '.DS_Store' | xargs wc -l 2>/dev/null
done

# Drift verification (expect no output for any of the seven)
for s in <same list>; do
  diff -rq "skill/$s/" "$HOME/.claude/skills/$s/" 2>&1 | grep -v '\.DS_Store'
done

# Global mtime survey
for s in <same list>; do
  stat -f '%Sm %N' "$HOME/.claude/skills/$s/SKILL.md"
done

# Git history for skill/
git log --oneline -- skill/ | head -30

# Tooling entry points
sed -n '1,11p' install.sh                      # the guard
head -80 tools/skills/publish.sh                # header + defense layers
head -40 tools/skills/verify-local.sh
head -40 tools/skills/validate-changelog.sh
cat tools/skills/schema/changelog.schema.json

# Web wiring
grep -n 'skills' apps/core/src/routes/actions.ts apps/core/src/routes/read.ts | head
wc -l apps/core/src/actions/publish.ts apps/core/src/skills/diff.ts \
      apps/core/scripts/record-publish.ts apps/web/src/screens/Skills.tsx

# Plugin surface already on the machine
cat ~/.claude/plugins/installed_plugins.json
ls  ~/.claude/plugins/marketplaces
wc -l docs/skills/CHANGELOG.jsonl              # currently 0
```
