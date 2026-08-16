# Skills → Plugins Migration Strategy

**Author:** writer-strategy (gosleep synthesis worker)
**Date:** 2026-08-15
**Status:** PROPOSAL — nothing in this document is auto-executed. Every step is gated on an
explicit owner decision (owner directive 2026-08-15). The standing safety rule — global
`~/.claude/skills/` is authoritative and agents never write it — remains in force throughout
and is only ever changed by the owner, explicitly.

**Evidence base** (read in full; disk re-verified where noted):

- `findings/plugin-architecture.md` — Claude Code plugin/marketplace reference (official docs
  fetched 2026-08-15 + live disk introspection + `claude 2.1.233` CLI).
- `findings/gstack-and-ecosystem.md` — gstack dissection + ecosystem patterns.
- `findings/current-state-and-fit.md` — our 12-skill inventory, requirements, fit/gap
  (including section 1.5, the 5 orphan owner skills).
- Disk re-checks this session: `docs/skills/CHANGELOG.jsonl` = 0 rows; `skill/` contains
  exactly the 7 tracked skills; PR #307 is OPEN, titled "GSL-174 Skills management system",
  branch `GSL-174-skills-management`.

---

## Executive summary

### Owner corrections (2026-08-15)

The following binding corrections were issued by the owner AFTER the first draft of this
strategy was written. The document has been rewritten to comply; this block is preserved so
the evolution of the strategy is traceable.

1. **The "source-of-truth inversion" (gosleep repo becomes editable truth, edits flow
   repo→global, manual global edits stop) is REMOVED from the near-term plan.** It becomes an
   explicitly FAR-FUTURE phase, gated on a hard precondition: **gosleep has become a full
   PRODUCTION system** (today it is an early prototype under active development), plus a
   separate owner decision at that time.
2. **Near term, the current direction is preserved and stated plainly: global
   `~/.claude/skills/` remain the editable source of truth.** The owner works across
   multiple projects, and any of them may edit the global skills when needed — that is
   precisely how the skills evolve today, and it must keep working unchanged. Sync direction
   stays **global → local** (the GSL-251 reverse-sync pattern), owner-commanded.
3. **The near-term plugin story becomes an interim snapshot-mirror model, honestly named.**
   The gosleep repo and the plugin packaging act ONLY as a **versioned snapshot mirror** of
   the global truth: periodic owner-approved global→local snapshot syncs become release
   snapshots, cut into semver plugin versions. Real benefits are delivered even in this mode
   — append-only history, visible diffs between releases, rollback targets, real backups
   (today one `rm` deletes an orphan skill forever), and packaging ready for the future.
   Honest limitation to state up front: in-place global edits still carry no per-edit
   author/reason; a release snapshot records the cumulative diff since the previous snapshot,
   not who/why per edit. Full per-edit provenance arrives only with the far-future inversion.
4. **Usage cutover (sessions invoking plugin skills as the primary path) is ALSO far-future**,
   gated identically. Near term, daily work continues on the loose global skills; any plugin
   installs are pilot / parallel / observational only, never the primary path.
5. **The owner's earlier question — "how would other projects contribute if the repo were the
   truth?" — is answered inside the far-future phase description**, not here: the
   contribution flow via the gosleep repo (edit in repo → release → update everywhere) is
   exactly what requires gosleep to be production-grade and ergonomically convenient first,
   which is why the flip waits.

**Owner refinement (2026-08-15, arrived mid-edit — folded in alongside the correction
above):** for the GLOBAL scope specifically, the owner wants an explicit named sub-plan of
four steps (G1-G4, section 4A-G): build global plugins for the 12 skills and install them
user-scope IN PARALLEL with the untouched loose global skills (namespacing keeps both live
simultaneously — verified fact, section 1.4); then, as an owner-approved step, add a short
deprecation stub line to each loose global `SKILL.md` steering selection to the plugin
version (loose skills NOT deleted — this is THE ONE sanctioned near-term write to
`~/.claude/skills/`, only by explicit owner approval); then a ~1-month trial working on
plugins during which edits to the migrated skills land via the marketplace repo folder
(version bump + `claude plugin update`), giving real edit history; then, if the month is
clean, the OWNER archive-moves the loose global copies to a dated backup folder (not `rm`,
so there is a final rollback layer). After G4, the marketplace repo folder is the editing
home for those 12 skills — a normal git-tracked local folder that any project edits as
easily as `~/.claude/skills/` today, plus commit history. **The FULL gosleep-harness
inversion (contribution flows through gosleep-as-product) STAYS far-future 4B**, unchanged
from the earlier correction; G4 is the lightweight owner-only workflow flip for the global
scope, not the productization step.

**Also new:** section 3C explicitly limits v1 bundles to skills only (keep the first step
simple) and names v2 candidates for once the flow is proven — an MCP server exposing
gosleep-core's local API to any project, versioned cross-project hooks, and packaged
subagents/commands for the verifier/report patterns.

**Owner decisions on D3 + D4 (2026-08-15).** The marketplace lives in a **dedicated
separate private repository** (owner's words: "мы сами сделаем отдельный репозиторий для
плагинов") — not the in-repo `plugins/` shape the prior draft recommended. The marketplace
/ repository name is **`gosleep-plugins`** (concrete repo path
`ainstance-labs/gosleep-plugins`, matching the org/private-repo pattern the gosleep app
repo already uses). All downstream references in this document have been updated: the
"marketplace repo folder" that becomes the editing home at G4 is this dedicated private
repo, populated by owner-commanded snapshots from the global truth (direction through
Phase 2 unchanged: `~/.claude/skills/` → gosleep `skill/` → `ainstance-labs/gosleep-plugins`
→ versioned release). Section 3A.2 (marketplace home), D3, D4, risk 1
(name-immutability), and risk 6 (credential-failure mitigation) reflect both decisions.

The remainder of this document reflects both the correction and this refinement. The prior
draft's "inversion now" content has not been discarded — it has been moved into the
far-future end-state section (section 3B) and the far-future phase block (section 4B),
clearly labeled as **NOT current work**.

### The pain (unchanged by the correction)

Production skills live at `~/.claude/skills/<name>/` with **no versioning and no provenance**.
The only metadata a production skill carries is a filesystem mtime (current-state-and-fit.md
section 4.2). We have documented unexplained drift: on 2026-08-03,
`orchestrating-delivery-agents` was +21/−12 lines and `using-jira` +16/−0 lines different from
the tracked copies, with zero record of who changed them, when, or why. Five owner-authored
skills exist ONLY globally, with no repo copy anywhere — a single `rm -rf` deletes any of them
forever.

### What plugins give us

Claude Code plugins are not "skills with a version number" — they are skills plus a native
install registry. Every plugin install/update writes `version`, `installedAt`, `lastUpdated`,
the exact `gitCommitSha`, `scope`, and an immutable versioned install path into
`~/.claude/plugins/installed_plugins.json` (plugin-architecture.md section 3.5 — verified live
on this machine, where `superpowers@6.2.0` already has exactly this record). Plugin skills are
namespaced (`plugin-name:skill-name`), so they coexist with the loose skills of the same name
— no collision, no cutover cliff. First-party tooling exists for validation
(`claude plugin validate --strict`), release tagging (`claude plugin tag`), and behavioral
evals (`claude plugin eval`).

Even under the interim snapshot-mirror model — where the plugin bundles are strictly a
downstream mirror of the global truth, not the editable side — these mechanics deliver real
value on day one: a versioned, hash-anchored release history; visible diffs between snapshots;
concrete rollback targets; a real backup of the orphan skills; and the packaging shape ready
for the eventual flip. What they do NOT deliver in this mode is per-edit author/reason
attribution, because edits still happen directly in the global tree; a snapshot records the
cumulative delta since the last snapshot, not who touched what and why. That gap closes only
when the far-future inversion happens.

### Recommended near-term path (all owner-gated, current direction unchanged)

**Through Phase 2, global `~/.claude/skills/` remains the editable source of truth,
unchanged from today.** The plugin bundles are a versioned snapshot mirror of that truth,
not a replacement for it. Daily work continues to invoke the loose global skills exactly
as today. **From G3 onward** (section 4A-G, the owner-refined global-scope sub-plan), the
marketplace repo folder becomes the editing home for the 12 migrated skills — still
lightweight, still owner-only, and still distinct from the far-future full-productization
step in 4B.

1. **Rescue the 5 orphans first** (Phase 0): reverse-sync `agentic-report-creator`,
   `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic` INTO
   `skill/` — a pure global → local copy into the repo, zero global writes, mirroring the
   GSL-251 pattern. This is the single most urgent step: it ends the "one `rm` deletes it
   forever" exposure for the five global-only skills.
2. **Build the snapshot-mirror packaging pipeline** (Phase 1): create the dedicated
   plugins repo (per D3-decided; owner sets up the empty private repo, tooling clones it
   locally), populate it with the `.claude-plugin/marketplace.json` + 3 bundle directories,
   and implement `snapshot-sync.sh` — the owner-commanded script that performs a read-only
   global → local sync into gosleep's `skill/`, then re-materializes the bundles inside
   the plugins repo working tree from `skill/`, then cuts a semver release (bump +
   CHANGELOG + validate + tag + push). Package the 12 skills as 3 thematic plugin bundles
   (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`) with semver in each
   `plugin.json`. Nothing is installed; the entire pipeline builds artifacts inside the
   two repos.
3. **Optional parallel pilot installs, observational only** (Phase 2): the owner MAY install
   one or two bundles at user scope, coexisting with the untouched loose global skills, to
   verify the mechanics work. Loose skills remain the primary path throughout; the pilot
   never becomes the way sessions actually invoke skills near term. Both `/handoff` and
   `gosleep-delivery:handoff` stay callable throughout.

**Far-future work (single hard gate: gosleep declared PRODUCTION by owner + separate owner
decision at that time):** usage cutover to plugin-primary; source-of-truth inversion
(repo→global); legacy decommission decision. All three are described in sections 3B and 4B
and are explicitly NOT current work.

### What we ask the owner to decide

Full list with options in section 7. Numbering (D1–D10) is preserved from the prior draft for
traceability; every decision has been re-checked against the corrected model. Packaging
granularity (D1), bundle composition and naming (D2), **marketplace home (D3 — DECIDED
2026-08-15: dedicated private repo `ainstance-labs/gosleep-plugins`)** and **name (D4 —
DECIDED 2026-08-15: `gosleep-plugins`)**, versioning rules for snapshot releases (D5), the
fate of PR #307 components and the CHANGELOG ledger under the snapshot-mirror model (D6),
the `orchestrating-delivery-agents` authority regime (D7 — near-term answer is unchanged
by construction: global stays authoritative through every near-term phase), Phase 0 scope
(D8), update discipline for pilot installs (D9), and the evidence bar for the far-future
flip (D10 — now anchored on the "gosleep = full production" precondition).

---

## 1. What a plugin is, concretely — and what it gives us beyond "skill + versioning"

### 1.1 Definition

A Claude Code plugin is a self-contained directory whose only required file is a manifest,
`.claude-plugin/plugin.json`, with one required field: `name` (kebab-case). Everything else is
optional. A plugin can be exactly one skill and nothing more (plugin-architecture.md
section 1.1). The manifest's optional `version` field (semver string) is what pins updates.

Verified real example on this machine — the installed `superpowers` plugin at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/` is: a manifest, a
`skills/` directory with 14 skills (each a folder with SKILL.md — structurally identical to
our `skill/<name>/` layout), and a hooks file. That is the whole thing.

A **marketplace** is a catalog: a directory (usually a git repo) whose
`.claude-plugin/marketplace.json` lists plugins and where to fetch them (relative path, github,
url, git-subdir, npm, archive, or command sources — plugin-architecture.md section 2.2).
Users register a marketplace once, then install plugins from it by name.

### 1.2 Direct answer to the owner's question: is a plugin just "skill + versioning"?

**No — it is strictly more.** The full delta over loose skills, from the evidence:

| Capability | Loose skill today | Plugin |
|---|---|---|
| Version on disk | none (mtime only) | `version` in plugin.json; versioned install path `cache/<marketplace>/<plugin>/<version>/` |
| Install provenance | none | `installed_plugins.json`: `installedAt`, `lastUpdated`, `gitCommitSha`, `scope`, `installPath` (section 1.3 below) |
| Namespacing | flat, first-write-wins on the filesystem | always `plugin-name:skill-name`; collisions with loose skills impossible for skills |
| Bundling | one skill per directory | skills + commands + agents + hooks + MCP servers + LSP configs + monitors + workflows + output styles + `bin/` executables in one versioned unit |
| Distribution | hand rsync (our guarded `publish.sh`) | marketplace install at user / project / local / managed scope; team auto-install via checked-in `.claude/settings.json` |
| Update semantics | whatever bytes land in the directory | explicit `claude plugin update`, version-gated; pinnable by semver or commit SHA; release channels possible |
| Enable/disable | delete the directory | `enabledPlugins` toggle per scope, no data loss |
| Validation | our `verify-local.sh` | first-party `claude plugin validate --strict` (same validator Anthropic's community pipeline runs), CI-ready |
| Release tooling | none | `claude plugin tag` creates `{name}--v{version}` git tags |
| Behavioral evals | none | `claude plugin eval` with ablation arms and graders |
| Persistent data | none | `${CLAUDE_PLUGIN_DATA}` dir survives updates |

For our immediate pain, the load-bearing subset is: **versioning + install provenance +
namespaced coexistence + validation**. The rest (bundled agents/hooks/MCP, release channels,
evals) is headroom we do not need on day one but get for free. We ship zero agents and zero
hooks in the migration itself (deliberately — see the agent-shadowing risk, section 6).

### 1.3 The provenance Claude Code records natively

This is the core of the case, so it is worth quoting the mechanism precisely
(plugin-architecture.md section 3.5, verified verbatim on this machine's
`~/.claude/plugins/installed_plugins.json`):

```json
"superpowers@claude-plugins-official": [{
  "scope": "user",
  "installPath": "…/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0",
  "version": "6.2.0",
  "installedAt": "2026-04-19T19:06:04.125Z",
  "lastUpdated": "2026-07-24T18:53:30.315Z",
  "gitCommitSha": "b55764852ac78870e65c6565fb585b6cd8b3c5c9"
}]
```

Every install records: scope (+ `projectPath` for project scope), the absolute versioned
install path, the resolved version, install and last-update timestamps, and — for git-backed
sources — the exact commit SHA. Loose skills get none of this; there is no registry file, no
version segment in the path, no SHA anywhere. The question the owner asked — "who changed what,
when" — literally cannot be answered from `~/.claude/skills/*/` and is answered natively by
this file for plugins (plugin-architecture.md section 8.2).

Two complementary provenance layers combine (section 3.4 below): the **source side** (git
history of the marketplace repo: author, timestamp, GSL key, commit message, diff) and the
**deployed side** (`installed_plugins.json`: what exact version is live, since when, from which
commit).

### 1.4 Coexistence semantics — the fact the whole soft transition rests on

Verbatim from the official docs (quoted in plugin-architecture.md section 4.2):

> "Plugin skills are namespaced as `/plugin-name:skill-name`, so the original `/skill-name`
> and the plugin copy both remain available rather than one overriding the other."

So loose `handoff` and plugin `gosleep-delivery:handoff` are **different names that both
resolve**, in the same session, with no collision possible. The current session's own skill
listing proves the merged discovery loop: it contains our loose skills, gstack's loose skills,
AND `superpowers:*` plugin skills side by side (current-state-and-fit.md R5).

One asymmetry to remember: **agents** are the opposite — a local `.claude/agents/` file
shadows a same-named plugin agent. We ship no agents in this migration, so the clause does not
bite us, but it is the reason the plan keeps agents out of the bundles until further notice
(section 6, risk 5).

---

## 2. Current state (compressed from findings)

### 2.1 The 12-skill fleet

Total confirmed owner-authored skills: **12** (current-state-and-fit.md sections 1 and 1.5).

**7 tracked in `skill/`** (repo-side mirror of the global production copies; byte-equal to
global since the GSL-251 reverse-sync, commit `db30235`, verified by empty `diff -rq` on
2026-08-15 — global remains the editable source of truth per the 2026-08-15 correction):

| Skill | Size | Structure | Nature |
|---|---|---|---|
| `orchestrating-delivery-agents` | 4 files, 1497 lines | SKILL.md + `references/` (3 files) | cross-project in principle; gosleep-laced |
| `delivery-workflow` | 114 lines | SKILL.md only | cross-project |
| `handoff` | 125 lines | SKILL.md only | cross-project |
| `using-jira` | 189 lines | SKILL.md only | cross-project |
| `writing-prds` | 221 lines | SKILL.md only | cross-project |
| `remote-control` | 100 lines | SKILL.md only | cross-project |
| `tmux-agents-orchestration` | 201 lines | SKILL.md only | cross-project |

**5 orphans — global-only, no repo copy anywhere** (current-state-and-fit.md section 1.5;
positively identified against gstack/gsd criteria across all ~138 global entries):

| Skill | Structure | Worst-case exposure |
|---|---|---|
| `agentic-report-creator` | SKILL.md (23 KB) + `references/` (5 files) + `templates/` | sole copy on this machine |
| `agentic-scenario-runner` | SKILL.md (25 KB) + `references/` (1 file) | sole copy |
| `efficient-agent-evals` | SKILL.md (5 KB) | sole copy; oldest (Jun 9) |
| `extra-usage` | SKILL.md (6 KB) | sole copy |
| `verifier-skeptic` | SKILL.md (31 KB, largest) + `references/` (3 files) | sole copy |

These five have the worst provenance story of the fleet: no git history anywhere, no author
trail, no backup — "mtime and nothing else, PERIOD." Roughly 91 KB of SKILL.md content alone,
plus references and templates. **A single `rm -rf` deletes any of them forever.** Rescue is
Phase 0 of the plan and is deliberately independent of every other decision.

Out of scope, explicitly: `gstack` (~55 skill folders — which, note, is NOT a plugin either;
it is a git clone with symlink fan-out and has the exact same versioning gap we do,
gstack-and-ecosystem.md section 1), the `gsd-*` cluster (~60 folders), and the three
marketplace-installed plugins. About 126 of the ~138 global entries are outside gosleep's
scope. Nothing in this strategy touches them.

### 2.2 The pain, verified structural

- Production copies carry only an mtime (current-state-and-fit.md section 4.2).
- Documented unexplained drift existed until GSL-251 copied the global state into git; without
  that one commit those diffs would still be untracked.
- The registry built to fix this — `docs/skills/CHANGELOG.jsonl`, schema-validated, appended
  by `publish.sh` — is implemented but has **0 rows** (re-verified this session). The
  sanctioned publish path has never fired end-to-end. The pain is unaddressed in production
  today.

### 2.3 PR #307 — the GSL-174 skills-management system

OPEN, titled "GSL-174 Skills management system", branch `GSL-174-skills-management`
(re-verified this session via `gh pr view 307`). It ships: the `publish.sh` owner-gated
publish path (4 defense layers), `verify-local.sh`, `record-publish.ts` (DB preflight +
CHANGELOG writer), `validate-changelog.sh` + JSON schema (skill enum currently closed to the
7 tracked names), the `skills` DB table, `GET /skills` + `GET /skills/:name/diff` read APIs,
`POST /actions/skills/publish`, and the `SkillsScreen` web UI (Publish button currently
disabled pending the TouchID pause, decision d-2026-08-09-001).

This system is a hand-rolled miniature marketplace for the loose-skill world. Section 5.2 maps
each component to its future under plugins; the headline is that **almost nothing is wasted**
— the owner-gate concept, the ledger schema, and the web surface all carry forward.

### 2.4 Constraints in force (binding)

1. **d-2026-07-20** — global skill copies authoritative; `install.sh` hard-disabled; agents
   never write `~/.claude/skills/`; `orchestrating-delivery-agents` never auto-synced.
2. **Owner directive 2026-08-15 (soft transition)** — skills and plugins coexist during
   migration; existing skills keep working untouched; the legacy decision comes only AFTER
   any full transition, for global and gosleep separately. (Note: constraint 4 below
   supersedes this directive's implicit near-term timeline — "full transition" is now
   explicitly a far-future 4B phase, not a near-term milestone.)
3. **Owner directive 2026-08-15 (approval-gated)** — every transition step happens only with
   owner approval. This document proposes; the owner decides.
4. **Owner correction 2026-08-15 (heavyweight inversion removed from near term) +
   refinement 2026-08-15 (lightweight global-scope flip permitted).** Through Phase 2,
   global `~/.claude/skills/` remain the editable source of truth; sync direction stays
   global → local (GSL-251 pattern), owner-commanded; plugin bundles act as a snapshot
   mirror. The owner-refined global-scope sub-plan (4A-G, G1-G4) then walks a
   **lightweight, owner-only, scoped flip** for the 12 migrated skills: parallel install
   (G1), owner-approved deprecation stubs (G2 — the one sanctioned near-term write to
   `~/.claude/skills/`), ~1-month trial with edits in the marketplace repo (G3), owner
   archive-move of the loose copies (G4). After G4 the marketplace repo folder is the
   editing home for those 12. The **heavyweight full gosleep-harness inversion**
   (contribution flows through gosleep-as-product, PR-based release ceremony, multi-project
   consumers) STAYS far-future 4B, gated on gosleep being declared a full PRODUCTION
   system plus a separate owner decision.
5. **d-2026-08-09-001** — TouchID/Keychain gate paused; TTY-confirm + env-nonce is the
   interim owner-gate.

---

## 3. Target architecture

Per the owner correction (2026-08-15), the target architecture is presented in two clearly
labeled halves:

- **Section 3A — Interim model (NOW, while gosleep is a prototype under active development).**
  Global `~/.claude/skills/` stays the editable source of truth. The plugin bundles are a
  versioned snapshot mirror of that truth. Sync direction is global → local, owner-commanded.
  All near-term work in this document (Phases 0/1/2 in section 4A) lives inside this model.
- **Section 3B — End-state model (FAR FUTURE, gated on gosleep = full PRODUCTION + a
  separate owner decision).** The source-of-truth inverts (repo becomes editable, edits
  propagate global via update); usage cutover flips sessions to plugin-primary; legacy
  decommission becomes decidable. This is explicitly NOT current work.

The two halves share the same packaging shape (three thematic plugin bundles, semver in
`plugin.json`, marketplace hosted in the dedicated plugins repo per D3-decided) — what
differs is the direction of edits, the
role of the repo, and the primary invocation surface for sessions. Naming the halves this
way keeps the interim benefits (backups, snapshots, semver history, packaging headroom) real
and honest without over-claiming provenance we cannot deliver until the flip.

---

## 3A. Interim model — snapshot mirror (near-term, current direction unchanged)

Design principles that hold across every part of 3A:

- **Global `~/.claude/skills/` is the editable source of truth.** Every project (gosleep and
  others) may edit it as it does today. Nothing in this strategy changes that.
- **Sync direction is global → local, owner-commanded.** The GSL-251 reverse-sync pattern is
  the only sanctioned way for content to move from global into `skill/`. Agents never write
  `~/.claude/skills/`.
- **The bundle trees inside the dedicated plugins repo are a downstream artifact of
  `skill/`.** They are regenerated (copied) from gosleep's `skill/` at snapshot/release
  time; they are not hand-edited during 3A. From G3 the direction flips for the migrated 12
  (they become hand-edited in the plugins repo directly).
- **Plugin bundles are a versioned snapshot mirror.** A release cuts the current state of
  `skill/` into a semver plugin version, tagged, ledgered, validated. Between releases the
  bundles do not change.
- **Honest limitation.** A snapshot release records the cumulative diff since the previous
  snapshot, not per-edit author/reason — because edits still happen directly in the global
  tree, outside any harness that could capture per-edit provenance. Per-edit attribution is
  a 3B property, not a 3A property. State this whenever the interim benefits are described.

### 3A.1 Packaging granularity — RECOMMENDATION: three thematic bundles (Option B)

| Option | Shape | Pros | Cons |
|---|---|---|---|
| A. One plugin, all 12 skills | `gosleep-harness` with `skills/` x12 | one version, one install, one catalog entry | every skill edit bumps the whole fleet's version; rollback is all-or-nothing; version history becomes noise |
| **B. Thematic bundles (recommended)** | 3 plugins grouping related skills | versions scoped to coherent groups; rollback scoped; a future consumer can install just the delivery conventions without tmux/evals baggage; 3 catalog entries is manageable | someone draws the lines (proposal below); 3 release cadences |
| C. Per-skill plugins | 12 plugins | finest-grained versioning and rollback | 12 catalog entries, 12 manifests, 12 version trails for a single-author fleet; bootstrap of a fresh machine = 12 installs; overhead disproportionate |

Both research workers independently leaned toward bundling (gstack-and-ecosystem.md open
question 2 leaned single-bundle-then-split; current-state-and-fit.md section 7.1 leaned
thematic). Option B is the recommendation because it directly serves the owner's stated pain:
version numbers that mean something ("the delivery conventions changed") rather than either a
fleet-wide version that changes for any reason (A) or twelve trails to correlate (C).

**Proposed bundle composition** (this is decision D2 — lines are drawable differently):

| Plugin | Skills | Rationale |
|---|---|---|
| `gosleep-delivery` | `delivery-workflow`, `using-jira`, `writing-prds`, `handoff` | the delivery conventions an agent needs to ship work against Jira+GitHub; evolve together |
| `gosleep-orchestration` | `orchestrating-delivery-agents`, `tmux-agents-orchestration`, `remote-control` | running and steering a fleet; the owner-facing control surface of a live shift |
| `gosleep-evals` | `agentic-scenario-runner`, `efficient-agent-evals`, `verifier-skeptic`, `agentic-report-creator`, `extra-usage` | measurement, verification, reporting, and spend policy; `verifier-skeptic` explicitly consumes `agentic-report-creator` per its frontmatter, so they belong together |

Notes: `extra-usage` is the least obvious placement (it is a session spend-policy modifier);
it sits in `gosleep-evals` because its subject matter is token economy, but moving it to
`gosleep-orchestration` is equally defensible — flagged in D2. Invocation names become
`gosleep-delivery:handoff`, `gosleep-orchestration:remote-control`,
`gosleep-evals:verifier-skeptic`, and so on.

**Reversibility warning that shapes this decision:** plugin `name` is **immutable once
shipped** — a rename requires a `renames` map in the marketplace and breaks nothing only if
done correctly (gstack-and-ecosystem.md pitfall 5). Regrouping skills BETWEEN bundles later is
cheap (skills move; bundle versions bump). Renaming or splitting the bundles themselves later
is the expensive move. So D1/D2 deserve a real owner decision now, not a default.

### 3A.2 Marketplace home — DECIDED by owner 2026-08-15: dedicated private repo (option b)

The prior draft weighed three options and recommended the in-repo `plugins/` shape. **The
owner has answered D3: the marketplace lives in a dedicated separate private repository**
("мы сами сделаем отдельный репозиторий для плагинов"). Repo name is still open (D4, D3
answered orthogonally). This subsection is retained to document the choice and its
consequences honestly; the trade-off table below captures what the decision buys and what
it costs.

| Option (for reference) | Pros | Cons |
|---|---|---|
| In-repo `plugins/` dir | provenance = the gosleep git history we already keep (GSL-keyed, one commit per Task); zero new infra; no credentials | marketplace registration stores a machine-local path; distribution is one-machine by default |
| **Dedicated private repo (DECIDED)** | clean separation "harness code" vs "installable plugins"; real remote distribution; matches the `nx@nx-claude-plugins` pattern; the marketplace repo folder is a plain git-tracked folder any project can clone/edit (the G4 end-state relies on exactly this) | private-HTTPS credential-helper failure on background updates (plugin-architecture.md section 2.4) is a real risk — mitigation: SSH remote + `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1`, plus D9 auto-update suppression as defense in depth; provenance discipline (GSL-keyed commits, PR-per-Epic) must be bootstrapped in the new repo from zero |
| Contribute to a public marketplace | — | owner's private conventions leak into a public catalog; ruled out |

**Consequences of D3 for the rest of the strategy.** Every reference in this document to
"the plugins repo," "the marketplace repo folder," or "<plugins-repo>" means the dedicated
private repo. Gosleep's own repo is unaffected (`skill/` in gosleep remains a
snapshot-mirror of global per section 3A relationship note through Phase 2; the dedicated
plugins repo is a further downstream mirror populated by the same owner-commanded snapshot
flow). Direction of flow through Phase 2:
`~/.claude/skills/` (edits) → gosleep `skill/` (owner-commanded sync) → dedicated plugins
repo (owner-run snapshot release). From G3 the marketplace repo folder becomes the editing
home for the migrated 12 (D6 sub-decision: whether gosleep `skill/` remains a redundant
mirror at that point, or is retired for the migrated 12, is worth pinning at G3).

Concrete layout at the top of the dedicated plugins repo (Phase 1 populates this; the repo
itself is created by the owner):

```
<plugins-repo>/
  .claude-plugin/
    marketplace.json          # name: gosleep-plugins (D4-decided); entries: 3 relative-path sources
  gosleep-delivery/
    .claude-plugin/plugin.json   # {"name":"gosleep-delivery","version":"0.1.0",…}
    skills/
      delivery-workflow/SKILL.md
      using-jira/SKILL.md
      writing-prds/SKILL.md
      handoff/SKILL.md
  gosleep-orchestration/
    .claude-plugin/plugin.json
    skills/
      orchestrating-delivery-agents/SKILL.md   (+ references/ subtree)
      tmux-agents-orchestration/SKILL.md
      remote-control/SKILL.md
  gosleep-evals/
    .claude-plugin/plugin.json
    skills/
      agentic-scenario-runner/SKILL.md         (+ references/)
      efficient-agent-evals/SKILL.md
      verifier-skeptic/SKILL.md                (+ references/)
      agentic-report-creator/SKILL.md          (+ references/ + templates/)
      extra-usage/SKILL.md
```

Layout rules baked in from the reference: only `plugin.json` lives inside `.claude-plugin/`;
`skills/` sits at the plugin root (the top documented runtime pitfall is getting this wrong —
plugin-architecture.md section 7). `references/` subtrees are preserved by local-path and git
sources (copy-based resolution), so `orchestrating-delivery-agents` and the three orphans with
references ship intact.

**Relationship to `skill/` (interim model, Phase 0 through Phase 2):** global
`~/.claude/skills/` is the editable source of truth; `skill/` is a downstream mirror of
global (kept current by owner-commanded global → local sync, GSL-251 pattern); `plugins/*/
skills/` is a further downstream mirror, rematerialized from `skill/` at snapshot/release
time. Direction of flow through Phase 2: `~/.claude/skills/` (edits happen here) →
`skill/` (sync-time copy) → `plugins/` (release-time copy). There is exactly one editable
surface (global), and everything downstream is a snapshot of it.

**Relationship to `skill/` from G3 onward (post-refinement, 4A-G):** the owner refinement
2026-08-15 introduces a scoped inversion — for the 12 migrated skills specifically, from
G3 the marketplace repo folder (`plugins/gosleep-*/skills/<name>/`) becomes the editing
home; edits propagate to the plugin cache via bump + `claude plugin update`. `skill/`
becomes downstream of `plugins/` for the migrated 12 (or the two directories may be
consolidated per D6). Global loose copies of the 12 are archive-moved by the owner at G4.
This scoped flip is a **lightweight owner-only workflow change for the global scope**,
distinct from the far-future 4B "full gosleep-harness inversion" — the difference is
scale and ceremony, not direction (section 4A-G boundary line spells this out).

**A note on the rejected fourth option** — the "skills-directory plugin" shortcut, where a
`.claude-plugin/plugin.json` dropped into each existing `~/.claude/skills/<name>/` folder
auto-loads it as a plugin (plugin-architecture.md section 4.5). It is the lightest mechanical
path and the architecture reference ranks it cheapest. This strategy rejects it anyway,
because it requires **writing manifests into the live global skill directories** — the exact
surface the soft-transition directive says stays untouched, and the exact surface the standing
safety rule forbids agents to write. It also blurs the legacy/new boundary that would make
a far-future decommission decision (F3) clean. The marketplace path keeps legacy
byte-untouched and puts the new surface in a separate, versioned, content-addressed cache.

### 3A.3 Versioning scheme — RECOMMENDATION: semver in `plugin.json`, and nowhere else

Rules, each grounded in a documented footgun:

1. **`version` lives in `plugin.json` only — never also in the marketplace entry.** The
   version resolution chain is: plugin.json, then marketplace entry, then git SHA, then
   sha256, then `unknown` (plugin-architecture.md section 3.1). If both are set, **the
   manifest wins silently** and can mask a bumped marketplace entry — the documented dual-set
   footgun. One source of truth: the manifest.
2. **Strict semver strings, starting at `0.1.0`** per bundle. In the interim model, releases
   are snapshots — each release captures the current state of `skill/` (which is itself the
   most recent global → local sync). `1.0.0` is not a snapshot milestone; it is reserved for
   the far-future flip (section 3B / phase F1) when the version number itself signals that
   sessions have moved to the plugin surface as primary.
3. **Every snapshot release bumps the version.** Setting `version` pins the plugin: users only
   receive updates when the field changes. Commits without a bump deliberately do NOT
   propagate — that is the stability feature (a mid-window global edit that hasn't been
   synced-and-released cannot silently reach any installed pilot) and the staleness footgun
   (forgetting to bump means an update never arrives). The snapshot-release script (section
   3A.4) makes the bump explicit and owner-gated.
4. **Tag releases with `claude plugin tag`** — the first-party primitive that creates a
   `{name}--v{version}` git tag and cross-validates the marketplace entry
   (plugin-architecture.md section 5.5). Tags give the source side an immutable release
   anchor that `git log` alone does not.
5. **`claude plugin validate --strict` gates every change to `plugins/`** — same validator
   Anthropic's community pipeline runs; wire into `gate.sh` or a pre-PR check (advisory until
   we have CI).

Alternative considered: the SHA-pinned-marketplace-entry style (Anthropic official catalog
style, no version in plugin.json, CI bumps the `sha`). Rejected for us: it requires the bump
automation we would have to build, and it makes the human-facing version a 40-char hash. The
semver-in-manifest style (the `nx` style, gstack-and-ecosystem.md section 2.5) is simpler and
matches a single-author fleet.

### 3A.4 Provenance flow — two layers, one snapshot-release script

**Honest scope statement first.** In the interim (snapshot-mirror) model, provenance answers
"what version is live where, and what changed between snapshots" — not "who made each
individual edit and why." Edits still happen directly in global `~/.claude/skills/`, outside
any harness that could capture per-edit attribution; the snapshot release captures the
cumulative diff since the previous snapshot, not the sequence of edits that produced it.
Per-edit author/reason attribution is a 3B property (it becomes possible only when the
editable surface moves into a git-tracked repo — the far-future flip). Do not oversell the
interim provenance; deliver what it actually delivers.

**Source-side provenance (what changed between snapshots):** the git history of the gosleep
repo over `plugins/` and `skill/`. Every snapshot release is a commit that captures the
global → local sync's cumulative diff, tagged with `{name}--v{version}`. Answering "what
changed in the handoff skill between v0.3.0 and v0.4.0" =
`git log --follow plugins/gosleep-delivery/skills/handoff/SKILL.md` between the two release
tags. This discipline already exists (GSL-keyed commits, one commit per Task); the migration
uses it, does not invent it.

**Deployed-side provenance (what is live where):** `~/.claude/plugins/installed_plugins.json`,
written by Claude Code itself on every install/update — version, timestamps, commit SHA,
scope, versioned install path (section 1.3). We never write this file; we only read it
(section 5.1). Deployed-side attribution is native and precise, regardless of interim vs
end-state.

**The `lesson` field** — the root-cause "why" our CHANGELOG schema carries — has no home in a
stock plugin manifest (current-state-and-fit.md section 7.4). Recommendation: keep
`docs/skills/CHANGELOG.jsonl` as the gosleep release ledger, repurposed — a row is appended at
**snapshot-release time** (version bump) rather than at rsync time. Schema survives nearly
verbatim (ts, skill/plugin, task, commit, lesson, status); the enum extends from 7 to 12
names (a one-line additive change already flagged in the findings). The `lesson` field, in
the interim, describes the snapshot's cumulative motivation ("caught up with two orphan
lessons landed globally between v0.2 and v0.3"), not per-edit reasoning.

**The snapshot-release script** — the owner-gate concept from `publish.sh` reappears one level
up, as a small `tools/skills/snapshot-sync.sh <plugin?>` that: (a) performs a read-only
global → local sync of tracked skill directories into `skill/` (GSL-251 pattern), (b)
rematerializes the affected `plugins/*/skills/` trees by copying from `skill/`, (c) verifies
the tree is clean, (d) bumps `version` in each affected manifest, (e) appends the CHANGELOG
row, (f) runs `claude plugin validate --strict`, and (g) creates the `{name}--v{version}`
tag. Same TTY owner-gate pattern `publish.sh` already implements (and the TouchID leg slots
in when d-2026-08-09-001 lifts). What it does NOT do: touch `~/.claude/skills/` (read-only
against global), install anything, or update anything. Installation and update remain
separate, owner-run commands (section 3A.6). This is Phase 1/2 work; listed here so the
architecture is complete.

### 3A.5 Distribution — pilot-parallel through Phase 2; full parallel-install at G1

**Global level (cross-project owner skills).** All 12 skills are cross-project by nature
(current-state-and-fit.md section 1 "Nature" column). Installs happen at **user scope**
(`-s user`, the default) — available in every project on this machine, recorded with
`scope: "user"` in the registry, exactly like `superpowers` today. Timing per the 2026-08-15
correction + refinement: **through Phase 2, loose global skills remain the primary path**;
Phase 2 installs are observational and do not change how sessions actually invoke skills.
The owner-refined global-scope sub-plan (4A-G) then escalates: G1 formally installs all
three bundles alongside untouched loose skills; G2 flips selection preference via
deprecation stubs; G3 begins the ~1-month trial with plugins as the primary invocation
path. The one caveat is `orchestrating-delivery-agents`, which is laced
with gosleep-specific ledger paths; the interim answer is unchanged (it stays authoritative
globally per d-2026-07-20, and D7 is answered by construction — see section 7).

**gosleep-project level (the harness).** Whether the project declares its plugin
expectations in the checked-in `.claude/settings.json` via `extraKnownMarketplaces` +
`enabledPlugins` (plugin-architecture.md section 6.1) is deferred to 3B. In the interim,
pilot installs (Phase 2) are done by the owner personally with
`claude plugin marketplace add` / `claude plugin install`; no `.claude/settings.json` edit is
required to make them work, and none is proposed in Phase 2. The declarative team pattern is
described in 3B, where it belongs.

**Verification note for Phase 1:** if in a later phase the owner wants the declarative
settings.json path, we still need to know whether `extraKnownMarketplaces` accepts a
local-path source cleanly — the documented examples use github-source marketplaces. Phase 1
performs the live check as a passive verification (no settings.json edit). Fallback (which
is what Phase 2 uses anyway) is a one-time `claude plugin marketplace add
<abs-path-to-repo>/plugins` at user scope — one manual, owner-run command.

### 3A.6 Update flow — explicit, owner-run, no silent auto-update

Documented actual behavior (plugin-architecture.md sections 3.2-3.3):

- `claude plugin update <plugin>` fetches the current source and installs it **only if the
  resolved version differs**. A restart is required to apply. Non-TTY contexts need `-y`.
- Marketplaces refresh in the background on session start; plugins then update per their
  resolved version. For a git-hosted private marketplace this is where the credential-helper
  failure lives; for our local-path marketplace there is no network fetch, but the refresh
  still re-reads the catalog from the working tree.

Policy recommendation (D9) — applies to pilot installs in Phase 2 and to any later interim
installs:

1. **Updates are explicit and owner-run**: the owner runs `claude plugin update <plugin>`
   after a snapshot release, then restarts. No agent runs install/update against user scope
   — the direct translation of the standing safety rule into the plugin world.
2. **Suppress background auto-update for the gosleep marketplace.** The ecosystem findings
   name `disableAutoUpdate` and `pluginRefreshFrequency` settings for exactly this
   (gstack-and-ecosystem.md section 3.3, avoiding-list item on auto-upgrade). Phase 1
   validation confirms the exact knob and scope on `claude 2.1.233`. The defense in depth is
   double: even if a background refresh fires, version pinning means nothing propagates
   unless a manifest version was bumped — and version bumps only happen through the
   owner-gated snapshot-release script.
3. **Night-shift stability rule**: no plugin updates mid-shift. Snapshot releases can be cut
   any time (they only touch the repo); applying them is an owner action at a shift boundary.
   This is the plugin-world equivalent of the reason gstack's snooze escalation exists.
4. Where the update-latency gotchas bite, know them: some installs need `/reload-plugins`
   before skills are discoverable, and updates need a session restart (section 6, risk 7).

---

## 3B. End-state model — source-of-truth inversion (FAR FUTURE, NOT current work)

**Gate:** every step in section 3B requires TWO conditions, both set by the owner:

1. **Gosleep is declared a full PRODUCTION system** by the owner. Today it is an early
   prototype under active development; that fact alone disqualifies the productized
   contribution flow. Gosleep (specifically apps/core + apps/web + the release tooling)
   must be production-grade AND ergonomically convenient before it can serve as the
   productized contribution surface for the dedicated plugins repo.
2. **A separate owner decision at that time**, taken with the evidence bar of D10 met.

Neither condition is presumed by this document. Section 3B exists so the shape of the future
is legible today (and so today's decisions do not paint us into a corner) — it does NOT
propose that any of this happens near term.

**Note on the D3 decision's effect on 3B.** With D3 answered (dedicated private plugins
repo), the editable-source-of-truth-lives-in-the-plugins-repo state already arrives at G4
(near-term, lightweight, owner-only). What 3B adds beyond G4 is the **productized
contribution ceremony**: PR-based multi-project contribution, formal review, CI, evals,
gosleep-core as the productized experience wrapping the plugins repo. 3B is no longer
mainly about "where the editable content lives" (G4 answers that) — it is about the
ceremony and ergonomics around that content maturing to production standards.

### 3B.1 What flips

- **Contribution flow productizes.** Direct-edit-in-the-plugins-repo (G4's model) is
  augmented by PR-based flow for cross-project contributions: another project opens a PR
  against the dedicated plugins repo, gosleep-core provides CI/validate/eval feedback,
  owner (or delegated reviewers) approve, snapshot cut, release. The plugins-repo folder
  remains editable directly for solo-owner edits; the PR path becomes the norm for
  cross-project contributions.
- **Per-edit provenance broadens.** From G4 on, per-edit provenance already exists (git
  commits in the plugins repo). What 3B adds: authored-by identity spans multiple
  contributors, review approvals become part of the record, CI results attach to the
  release.
- **Usage cutover: sessions invoke plugin skills as the primary path everywhere.**
  Bare-name invocation of the 12 becomes discouraged in guidance across all projects;
  `plugin-name:skill-name` becomes the preferred form. Loose global copies remain callable
  (Claude Code namespacing makes coexistence possible indefinitely), but they are no
  longer the default surface anywhere.
- **Legacy decommission becomes decidable at scale.** G4 already archive-moved the 12
  globally on this machine; 3B considers the same decision for any other consumer machine
  that inherited them via install.
- **`orchestrating-delivery-agents` authority regime is re-decided by the owner.** The
  "global copy is authoritative" rule, written for the rsync world, is either retired in
  favor of "plugins repo + release flow is authoritative" or explicitly restated.

### 3B.2 The owner's earlier question, answered here

The owner asked: "if the repo were the source of truth, how would other projects contribute
to skills?" The G4 answer (near-term) is: they clone the dedicated plugins repo and edit
it directly like any git folder. The 3B answer (far-future, productized): they open a PR
against the dedicated plugins repo; gosleep-core provides validate/eval feedback in CI;
owner (or delegated reviewers) merges; snapshot cut; every consumer runs
`claude plugin update` at a shift boundary. This flow is straightforward mechanically.
What it requires ergonomically — and this is why the productization waits — is that the
apparatus around the plugins repo (CI, review UX, evals, notification loops, gosleep-core
harness) be **production-grade, convenient enough that a one-line lesson from another
project is a low-ceremony contribution**. Today's prototype gosleep does not yet clear
this bar. Once it does — and only then, per the 2026-08-15 correction — the productization
becomes worth proposing.

### 3B.3 What does NOT flip

- The four-layer defense (CLAUDE.md rule, owner-gate on writes, test-guard on the live path,
  install.sh guard) remains — its subject expands from `~/.claude/skills/` to also cover
  `~/.claude/plugins/**`, but the pattern is identical.
- Semver-in-manifest, dedicated-private-repo marketplace (per D3-decided:
  `ainstance-labs/gosleep-plugins`), three thematic bundles, `plugin validate --strict` in
  the release gate — the interim packaging shape is exactly the end-state packaging shape.
  Nothing about 3B invalidates 3A's mechanical choices; that is the point.

---

## 3C. Other plugin components (v2, once flow is proven)

v1 bundles ship **skills only** — keep the first step simple, prove the release/install/
update loop end-to-end, get the deprecation-stub + trial + archive-move flow (section 4A-G)
through one clean cycle. Everything below is v2 candidate work, considered only after v1
is stable and only if the owner opts in per item.

- **MCP server exposing gosleep-core's local API.** A small plugin ships an MCP server that
  proxies apps/core (`GET /questions`, `GET /fleet`, `GET /timeline`, `GET /events`, and
  friends) so any project's session gets first-class harness tools instead of shell scripts
  and one-off curl commands. Zero-config for the consumer once the plugin is installed —
  matches how session-connected MCP tools surface via ToolSearch today.
- **Versioned cross-project hooks.** Safety rails currently hand-installed per project
  (stop-require-final-text, wake-up-first-text-last variants, guarded skill-editing
  checks) become versioned entries in the appropriate bundle's `hooks/` — installable and
  rollback-able like any other plugin content. Same owner-gate as any other release.
- **Packaged subagents and commands for the verifier/report patterns.** The `verifier-skeptic`
  workflow, the report-generation flow, and other recurring orchestration patterns can ship
  as bundled subagents and slash-commands. **The local-shadows-plugin agent nuance
  (section 1.4, risk 5) bites here** — a same-named local `.claude/agents/` file overrides
  the plugin's version, unlike skills — so this needs its own decision when introduced
  (naming convention that avoids collision, or explicit expectation that the plugin form
  is the authoritative one).

Nothing in 3C is scheduled by this strategy; it is listed so v1 stays disciplined (skills
only) and the shape of a future v2 is legible.

---

## 4. Migration plan — the phased ladder

The ladder is split into two sections to make current work vs future work unambiguous.
Section 4A is what this strategy actively proposes for near-term execution (all owner-gated).
Section 4B describes the far-future work that lives behind the "gosleep = full PRODUCTION"
gate and is explicitly NOT current work.

## 4A. Near-term phases (interim snapshot-mirror model)

Design principles, restated as invariants that hold in EVERY near-term phase:

- **Global authoritative, untouched by agents:** no near-term phase writes, moves, or
  deletes anything under `~/.claude/skills/`. Global remains the editable source of truth;
  owner and other projects continue to edit it directly, exactly as today. Agents may only
  READ global (for the snapshot sync).
- **Loose global skills stay the primary path:** near-term daily work continues to invoke
  loose skills under their bare names. Plugin bundles are a snapshot mirror, and any pilot
  installs are observational only — never the primary path near term.
- **Owner-gated:** each phase begins only after an explicit owner GO on its gate, and the
  gates are decisions, not notifications.
- **Reversible:** each phase has a rollback story that restores the previous state without
  data loss.
- **Agents never write `~/.claude/**`:** phases whose steps touch user-level state
  (marketplace add, plugin install/update) are executed by the owner personally, or by an
  agent only under an explicit, logged owner sanction for that specific command.

### Phase 0 — Orphan rescue (do first; independent of every other decision)

- **What changes:** the 5 global-only skills (`agentic-report-creator`,
  `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic`) are
  copied INTO the repo as `skill/<name>/` — full subtrees including `references/` and
  `templates/`, mirroring the GSL-251 reverse-sync pattern. Pure read of global, pure write
  into the repo. Optionally in the same task: extend the CHANGELOG schema enum from 7 to 12
  names.
- **What keeps working (unchanged):** everything. Global `~/.claude/skills/` remains the
  editable source of truth and the live production surface. Owner and other projects
  continue to edit skills directly in global exactly as today. This phase adds a repo-side
  backup mirror; it changes zero runtime behavior.
- **Rollback:** `git revert` of the vendoring commit. Global state was never touched, so
  there is nothing to restore.
- **Owner gate:** approve the reverse-sync of these 5 named skills (D8), including the
  standing question "are there other orphans this inventory missed?" — the search covered all
  ~138 global entries and found exactly these 5.
- **Effort:** 1-2 hours. **Risk:** near zero. **Value:** ends the "one rm from permanent
  loss" exposure for the 5 orphans immediately, before any architecture work.

### Phase 1 — Snapshot-mirror packaging pipeline (built passively from snapshots, nothing installed)

- **What changes:** the owner creates the dedicated private plugins repo (per D3-decided;
  clones it locally). The tree from section 3A.2 is populated at its root (3 manifests, 1
  marketplace.json, skill trees copied from gosleep's `skill/`), and the
  `tools/skills/snapshot-sync.sh` script (section 3A.4) is implemented in gosleep — the
  owner-commanded read-only global → local sync into gosleep's `skill/`, followed by
  rematerialization of the bundle trees inside the plugins repo working tree, semver bump,
  CHANGELOG row, `claude plugin validate --strict`, `claude plugin tag`, and `git push` in
  the plugins repo. The pipeline is exercised once end-to-end to produce the initial
  `0.1.0` snapshot per bundle. Phase 1 also runs two passive verifications: whether
  `extraKnownMarketplaces` accepts the SSH URL of the dedicated repo cleanly, and what
  the exact auto-update suppression knob is on `claude 2.1.233` (section 3A.6). Optionally,
  first `claude plugin eval` cases for one bundle.
- **What keeps working (unchanged):** everything. Nothing is installed. `~/.claude/skills/`
  is only READ by `snapshot-sync.sh` (global → local direction, GSL-251 pattern) and never
  written. Loose global skills remain the primary path. `publish.sh` remains the only
  sanctioned owner-gated writer for the loose-skill legacy surface.
- **Rollback:** delete or force-reset the dedicated plugins repo; revert the
  `snapshot-sync.sh` script from gosleep. Snapshot commits under gosleep's `skill/` from
  the pipeline's first run are additive repo history and need no rollback (byte-equal to
  global at snapshot time by construction).
- **Owner gate (two-stage):** BEFORE build — approve the remaining architecture decisions
  D1, D2, D5 that the tree encodes (D3 and D4 are already decided — dedicated repo
  `ainstance-labs/gosleep-plugins`). AFTER build — review the validation results, the
  smoke-test transcript (via `claude --plugin-dir <path-to-plugins-repo>/gosleep-delivery`,
  sideload flag from plugin-architecture.md section 4.4), and the two verification items
  before Phase 2 is even proposed.
- **Effort:** 0.5-1 day including the pipeline, the first snapshot, validation, and the
  two verification items (marginal extra work for the second-repo setup). **Risk:** none
  to production; the work product is inert files in the two repos plus a read-only script.

### Phase 2 — Optional parallel pilot installs (observational only, loose skills remain primary)

- **What changes (only if the owner opts in):** the owner personally runs, on this machine:
  `claude plugin marketplace add <plugins-repo>`, then
  `claude plugin install gosleep-delivery@gosleep-plugins` (recommended pilot: the delivery
  bundle — low-risk, high-frequency skills; optionally also `gosleep-evals`). Claude Code
  copies the plugin into its versioned cache and writes the first real provenance rows into
  `installed_plugins.json`. From the next session, `gosleep-delivery:handoff` etc. are
  callable **alongside** the unchanged bare-name skills.
- **What keeps working (unchanged):** every loose skill, byte-untouched. Global stays the
  editable source of truth. Bare-name skill invocation remains the PRIMARY path — the pilot
  installs are observational, not a cutover. Skill namespacing makes collisions impossible
  for skills (section 1.4). The agent-shadowing nuance is moot by construction: the bundles
  ship zero agents.
- **Observation:** a defined window (suggest 3-7 shift days) in which the owner (or
  designated sessions, deliberately) exercise the namespaced skills side-by-side with their
  loose twins. Success criteria: (a) both names resolve, (b) plugin skills behave identically
  to their loose twins, (c) `installed_plugins.json` shows the expected version rows,
  (d) no surprise auto-updates occurred, (e) a subsequent snapshot release + owner-run
  `claude plugin update` propagates cleanly. This is the interim model verifying itself,
  not a prelude to cutover.
- **Rollback:** `claude plugin uninstall gosleep-delivery` (+
  `claude plugin marketplace remove gosleep-plugins` if desired) — removes the cache copy and
  registry rows; loose skills were never touched, so behavior returns to exactly today.
- **Owner gate:** approve the pilot install (the commands are run by the owner, which IS
  the gate). At window end, review the observations. Phase 2 has NO successor phase near
  term — the next step is either "keep pilots running, cut more snapshot releases as global
  evolves" or "pause the pilots"; either is fine, and both are inside the interim model.
  Anything beyond that lives in section 4B.
- **Effort:** under 1 hour of commands + the observation window.

### Near-term phase ladder at a glance (Phase 0/1/2 only; G1-G4 follows separately)

| Phase | One-liner | Writes to `~/.claude/**`? | Editable source of truth | Executed by | Rollback | Effort |
|---|---|---|---|---|---|---|
| 0 | Rescue 5 orphans into repo (backup mirror) | none (read-only global) | global (unchanged) | agents (repo writes only) | git revert | 1-2 h |
| 1 | Build snapshot-mirror pipeline + first snapshot; nothing installed | none (read-only global) | global (unchanged) | agents (repo) + read-only CLI | delete dir/script | 0.5-1 d |
| 2 | Optional parallel pilot installs, loose skills primary | by Claude Code, via owner-run commands | global (unchanged) | owner | `plugin uninstall` | <1 h + window |

## 4A-G. Global-scope migration sub-plan (G1-G4) — owner-refined 2026-08-15

**Scope of this sub-plan.** GLOBAL only — the 12 owner-authored skills currently at
`~/.claude/skills/`. Each step is owner-gated; the trial window is the owner's stated
~1-month figure. This sub-plan is a **lightweight owner-only workflow flip for the global
scope** — after G4, the marketplace repo folder (the dedicated private plugins repo per
D3-decided) is the editing
home for those 12 skills, edited as a normal git-tracked local folder that any project can
open as easily as `~/.claude/skills/` today, plus commit history. **The FULL gosleep-harness
inversion — contribution flows through gosleep-as-product with the ceremony a production
system deserves — STAYS far-future 4B**, unchanged. G4 does not require gosleep to be
production; 4B does.

### G1 — Install global plugin bundles in parallel with untouched loose global skills

- **What changes:** the owner runs
  `claude plugin marketplace add <plugins-repo>` and
  `claude plugin install gosleep-delivery@gosleep-plugins`,
  `... gosleep-orchestration@ ...`, `... gosleep-evals@ ...` at user scope. Both invocation
  paths are live simultaneously: `handoff` (loose global) and `gosleep-delivery:handoff`
  (plugin). The verified coexistence fact (section 1.4, quoted from the official docs)
  makes this safe by construction: "the original `/skill-name` and the plugin copy both
  remain available rather than one overriding the other."
- **What keeps working:** every loose global skill, byte-untouched.
- **Rollback:** `claude plugin uninstall <bundle>`. Global loose skills need no restore.
- **Owner gate:** approve installing all three bundles (or start with one and stage the
  others — either fits G1).
- **Effort:** under 1 hour of commands, per bundle.

### G2 — Owner-approved deprecation stubs in each loose global SKILL.md

- **What changes:** a single-line deprecation stub is added to each of the 12 loose global
  `SKILL.md` files, of the form:
  `> **Deprecated (2026-08-XX):** superseded by \`<bundle>:<skill>\`; use the plugin
  version.` The stub steers Claude's skill-selection scan toward the plugin invocation
  without disabling the loose skill in any way.
- **The safety-rule caveat, front and center.** This is **THE ONE sanctioned near-term
  write to `~/.claude/skills/`**. The standing safety rule (d-2026-07-20) that agents
  never write `~/.claude/skills/` remains in force by default; G2 is the single named
  exception, executed only under explicit owner approval per specific skill (or per
  batch). Recommended: the owner runs the stub-adder script personally, or an agent runs
  it under an explicit logged owner sanction with the script hard-scoped to the 12
  named files. Under NO circumstances is this a general reopening of the safety rule.
- **What keeps working:** the loose skills continue to resolve and run; only the frontmatter
  guidance shifts selection preference.
- **Rollback:** `git`-track the stub lines (they can be applied as a diff), or simply
  remove the added line — trivially reversible per file.
- **Owner gate:** explicit per-skill or per-batch approval; the stub text itself; the
  execution mechanism (owner-run vs sanctioned agent run).
- **Effort:** 15-30 minutes.

### G3 — ~1-month trial working on plugins (edits land via the marketplace repo)

- **What changes (behavior):** for ~1 month, real work exercises the namespaced plugin
  invocations. Any lesson worth writing into a migrated skill is edited in the marketplace
  repo folder (`<plugins-repo>/gosleep-*/skills/<name>/SKILL.md` per D3-decided) — snapshot bump
  is not required for edits inside this trial; the owner runs the release script (bump +
  CHANGELOG row + validate + tag) plus `claude plugin update <bundle>` + session restart
  to propagate to the plugin cache. Global loose skills are NOT edited during the trial
  (the deprecation stub from G2 already steers away from them). The trial produces the
  first real edit history for these skills — commits, tags, ledger rows.
- **What keeps working:** the loose global skills are still callable if a session ignores
  the stub or explicitly asks for the bare name. Owner rollback at any time is trivial —
  see G4 rollback.
- **Rollback:** stop editing in the repo, resume editing directly in `~/.claude/skills/`,
  optionally uninstall the plugins. The stub lines from G2 can be reverted; no data lost.
- **Owner gate:** kick-off of the trial (explicit start date so the month is well-defined);
  mid-trial check-in optional; end-of-trial go/no-go for G4.
- **Effort:** ~1 month wall-clock; small ongoing effort for edits + releases + updates.

### G4 — Owner archive-moves the loose global copies (final rollback layer preserved)

- **What changes:** after a clean trial, the owner **archive-moves** (not `rm`) the 12
  loose global skill directories from `~/.claude/skills/<name>/` to a dated backup folder
  such as `~/.claude/skills/_deprecated-YYYY-MM-DD/<name>/` (exact path is an owner
  choice). Archive-move preserves a final rollback layer: any regret is one `mv` back.
  Executed by the owner personally — the standing safety rule outlives the sub-plan; G4
  is a specific one-time owner-gated exception to the "never delete under `~/.claude/`"
  norm, and even then it is a move, not a delete.
- **After G4 (state to name honestly):** the marketplace repo folder IS the editing home
  for those 12 skills. Practically: it is a normal git-tracked local folder — any project
  on this machine can `cd` into it, edit a SKILL.md, commit, and (per the release loop)
  cut a snapshot to propagate the change to the plugin cache and thus into every session
  on this machine. This is a real convenience win over `~/.claude/skills/` (which had no
  commit history) without requiring gosleep to be a "full production system" first.
- **What keeps working:** the plugin invocations, unchanged from G3. If a session ever
  needs the loose form back, `mv` the archived directory back and the bare name resolves
  again immediately.
- **Rollback:** `mv` the archived directory back to `~/.claude/skills/<name>/`. Truly
  final rollback: reinstall from the repo (all 12 are tracked as of Phase 0).
- **Owner gate:** explicit end-of-trial approval; the archive path; the timing.
- **Effort:** 15-30 minutes.

### Boundary line (this sub-plan vs. the far-future 4B)

G4 is a **lightweight owner-only workflow flip for the global scope** — one user, one
machine, edits in a git-tracked folder, plugin cache updated by `claude plugin update`.
It does NOT require gosleep to be a production system, because the "contribution flow"
inside G4 is just "own a folder, edit it, run two commands." **4B is a different scale of
change**: multiple consumers, multiple projects contributing via PR-based release
ceremony, gosleep-as-product with the ergonomics a real product needs. Only 4B needs the
"gosleep = full PRODUCTION" precondition (D10). G4 does not, and this document treats them
as different phases on purpose.

### G1-G4 at a glance

| Step | One-liner | Writes to `~/.claude/**`? | Editing home after step | Executed by | Rollback | Effort |
|---|---|---|---|---|---|---|
| G1 | Install 3 global plugin bundles alongside loose skills | none (Claude Code writes plugin cache via owner-run install commands) | still `~/.claude/skills/` | owner | `plugin uninstall` | <1 h |
| G2 | Owner-approved deprecation stubs added to each of the 12 loose SKILL.md | YES — the one sanctioned near-term write, per-skill or per-batch owner approval | still `~/.claude/skills/`, plugin invocation preferred | owner (or sanctioned agent, hard-scoped) | remove stub lines | 15-30 min |
| G3 | ~1 month trial; edits land in the dedicated plugins repo + release/update loop | none | dedicated plugins repo (per D3) for the trial period | owner | resume `~/.claude/skills/` editing; uninstall plugins | ~1 month |
| G4 | Owner archive-moves loose global copies to dated backup folder | YES — the owner-performed archive-move (a `mv`, not `rm`) | marketplace repo folder is now the editing home for the 12 | owner | `mv` the archive back | 15-30 min |

## 4B. Far-future phases (gated on gosleep = full PRODUCTION + separate owner decision)

**Hard gate on every 4B phase:** the owner must first declare that gosleep is a full
production system (D10 codifies the evidence bar), then take a separate decision to proceed
with the flip. Neither is presumed. Section 4B exists so the future is legible today, not
because any of it is scheduled.

**Framing after D3 + G-plan.** With D3 answered (dedicated plugins repo) and the G-plan
achieving parallel install + deprecation stubs + trial + archive-move for the migrated 12
on this machine, most of what a "usage cutover" or "source-of-truth flip" meant in the
prior draft is delivered near-term by G1-G4. What 4B adds is the **productized contribution
ceremony at scale** — PR-based cross-project contribution flow, CI/eval feedback, review UX,
gosleep-core as the productized harness wrapping the plugins repo — and the corresponding
decommission decisions once multiple consumers exist. The F1-F3 blocks below reflect that
scope.

### Phase F1 — Cross-project usage cutover and declarative team distribution

- **What changes:** the checked-in `.claude/settings.json` of every gosleep consumer gains
  `extraKnownMarketplaces` + `enabledPlugins` for the dedicated plugins marketplace, so a
  freshly-cloned workspace auto-provisions the bundles (after the workspace-trust dialog).
  Guidance surfaces (CLAUDE.md across projects, skill cross-references, docs pointing at
  `/handoff` etc.) standardize on the namespaced invocation. G-plan already delivered
  this on the owner's own machine; F1 extends it to other consumers.
- **What keeps working:** loose global copies (where they still exist on any given machine)
  remain callable — Claude Code namespacing makes coexistence permanent.
- **Rollback:** revert the settings.json + guidance edits; sessions continue on either
  surface.
- **Gate:** the 4B gate (production + separate owner decision).

### Phase F2 — Productized contribution ceremony wrapping the dedicated plugins repo

- **What changes:** cross-project contribution moves to PR-based flow against the dedicated
  plugins repo. Gosleep-core provides CI/validate/eval feedback attached to each PR;
  reviewers approve; snapshot cut; consumers receive updates via the F1 declarative path.
  Direct-edit-in-the-plugins-repo (the G4 model) remains available for solo owner work;
  the PR path becomes the norm for cross-project contributions. Bundle versions bump to
  `1.0.0` at the productization moment — the version number itself signals the ceremony
  arrived.
- **What keeps working:** the G4 direct-edit workflow, so solo-owner iteration speed is
  preserved; loose global copies (where still present) remain resolvable; the four-layer
  defense expands its subject to `~/.claude/plugins/**` per section 3B.3.
- **Precondition evidence** (baseline in D10): gosleep declared full production; G4 landed
  and observed; the productized flow (edit → PR → CI feedback → merge → release → update)
  walked through end-to-end at least once with a real cross-project contribution.
- **Rollback:** re-emphasize direct-edit workflow; PR path becomes optional. Repo history
  remains as append-only record.
- **Gate:** the 4B gate, plus D10 evidence, plus a specific "adopt the productized
  ceremony" decision at that time.

### Phase F3 — Legacy decommission at scale (separate decision, taken only after F2)

- **What is decided (not presumed):** for consumer machines that received the loose global
  skills via install (i.e. beyond the owner's machine, where G4 already archive-moved
  them), and for the legacy publish machinery on the gosleep side (`publish.sh` in its
  rsync role, `record-publish.ts check` mode, the `skills` DB table as a publish target),
  what is the retirement policy?
- **Options per level:** keep frozen as a rollback surface for N months (the same pattern
  the project already uses for the deprecated static site, per CLAUDE.md); or archive
  (move aside) then delete; or delete outright. Any deletion under `~/.claude/` on any
  machine is executed by that machine's owner personally — the standing rule outlives the
  migration unless the owner explicitly retires it.
- **Rollback after deletion:** reinstallable from the dedicated plugins repo (or, for a
  pre-migration state, from gosleep's `skill/` — which after Phase 0 contains all 12
  skills).
- **Gate:** the 4B gate, plus F2 landed and observed, plus a specific decommission
  decision. This document deliberately does not recommend an outcome — only that the
  decision be scheduled no earlier than a sustained observation window after F2.

### Far-future phase block at a glance

| Phase | One-liner | What is new beyond G4 | Gate |
|---|---|---|---|
| F1 | Cross-project usage cutover + declarative team distribution | consumers beyond the owner's machine auto-provision plugins | 4B gate |
| F2 | Productized contribution ceremony (PR + CI + evals) around the plugins repo | multi-project contribution has proper review UX | 4B gate + D10 + explicit productization decision |
| F3 | Legacy decommission at scale (per level, per consumer) | retirement policy for any remaining loose copies beyond the owner's machine | 4B gate + F2 landed + explicit decommission decision |

---

## 5. How gosleep-as-harness integrates

### 5.1 The web control plane surfaces plugin provenance (sketch, not a design)

The control plane (apps/core + apps/web) is the natural reader of the provenance the migration
creates. The sketch, sized as one small epic after Phase 2 (only if pilots are installed):

- **`GET /plugins`** on apps/core: reads `~/.claude/plugins/installed_plugins.json` and
  `known_marketplaces.json` (read-only — the harness never writes them) and joins with the
  repo-side `plugins/*/.claude-plugin/plugin.json` manifests. Per bundle:
  installed version vs latest snapshot version ("newer snapshot available" = repo manifest
  version differs from installed), `installedAt`, `lastUpdated`, `gitCommitSha`, scope.
- **Skills screen evolves** into two tabs: the existing loose-skill registry view (the
  primary surface through Phase 2, then a coexistence-tracking view from G1-G4) and an
  "Installed plugins" view driven by `GET /plugins`. The existing diff engine
  (`computeSkillDiff`) can point at snapshot-vs-global (does the latest snapshot match live
  global?) as its interim job, and at cache-vs-repo (is the installed bundle on the latest
  release?) as a secondary view. During G3 it also usefully shows "which of the 12 has a
  deprecation stub applied vs not."
- **Timeline events** for snapshot releases: the snapshot-release script emits a
  `skills.snapshot.release` event the same way publish.sh emits `skills.publish.done` —
  provenance lands in the events table the owner already reads.
- **No write actions from the web for plugin install/update** in any near-term iteration —
  updates stay owner-run CLI (section 3A.6). A gated "update" button is a far-future
  possibility behind the TouchID gate once d-2026-08-09-001 lifts; explicitly out of scope
  here.

### 5.2 PR #307 components under plugins — what each piece becomes

Recommendation up front (part of D6): **merge PR #307 as designed.** It protects and manages
the loose-skill surface — the surface that stays authoritative through every near-term
phase. The CHANGELOG-as-release-ledger role fits the snapshot-mirror model naturally: rows
appended at snapshot-release time (interim) evolve to rows appended at per-edit release time
(far-future 4B), same schema, additive change. Re-scoping an open PR mid-flight to
accommodate a future architecture would delay the protections the loose skills need today.
The reframing below happens as follow-up epics, not as edits to #307.

| PR #307 component | Near term (4A: interim snapshot-mirror) | Far future (post-F3, if legacy retires) |
|---|---|---|
| `publish.sh` (owner-gated rsync) | KEPT — remains the only sanctioned way for the owner to push loose-skill edits from the repo to global, exactly as today | retires in the rsync role after F2; the owner-gate pattern lives on in `snapshot-sync.sh` and, later, the F2 release script |
| `verify-local.sh` | KEPT — validates the loose-skill payload before publish | logic reusable as a pre-release check alongside `plugin validate --strict` |
| `record-publish.ts` | KEPT (check + write modes as designed) | `check` mode moot; `write` mode becomes the release recorder |
| `docs/skills/CHANGELOG.jsonl` + schema | KEPT; enum extends 7 → 12 in Phase 0; a row per owner publish AND (from Phase 1 onward) a row per snapshot release — both write into the same ledger, distinguished by a `kind` field or the target skill/plugin name | KEPT — becomes the per-edit release ledger; the `lesson` field (no home in a stock plugin manifest; section 3A.4) finally holds per-edit reasoning rather than snapshot-cumulative reasoning |
| `validate-changelog.sh` | KEPT | KEPT (schema gains a plugin/version field variant) |
| `skills` DB table + `GET /skills` + diff | KEPT — the diff engine is genuinely useful in 4A as "does the latest snapshot match live global?" (section 5.1) | evolves per section 5.1; diff engine re-pointed |
| `POST /actions/skills/publish` + Skills screen Publish button | KEPT (button disabled per d-2026-08-09-001, as today) | becomes moot for plugins (updating is a CLI action); screen evolves per section 5.1 |
| Four-layer defense | KEPT verbatim — near term the subject is `~/.claude/skills/`, which stays the editable authoritative surface | re-maps at F2: CLAUDE.md rule extends to `~/.claude/plugins/**`; owner-gate moves to release + owner-run update; test-guard watches the plugin cache for unsanctioned mutation; install.sh guard stays |

**Conflicts flagged as owner decisions (inside D6):** (a) the dual version story — the
`skills` DB table has a `version` column (loose-skill publish version) and plugin manifests
have `version` (snapshot release version). Near term these are separate surfaces (loose
publish vs plugin snapshot) and must not be conflated in the UI. (b) `plugins/*/skills/`
is generated from `skill/` through Phase 2; from **G3 onward** it becomes hand-edited (the
marketplace repo folder is the editing home for the 12 during and after the trial), and
`skill/` becomes downstream of `plugins/` — the direction inside the repo inverts at G3
even though the "full gosleep-harness inversion" (4B) stays gated. Snapshot-sync from
global into `skill/` remains a valid tool for any skill that is NOT yet migrated (during
the pre-G3 window) or for a rollback scenario. (c) the CHANGELOG enum extension timing
(Phase 0 recommended). (d) the deprecation-stub script (G2): owner-run vs sanctioned-agent
run, and the exact stub text — both worth pinning before G2 executes.

---

## 6. Risks and pitfalls

Consolidated from the findings; each with the mitigation this strategy adopts.

1. **Plugin/marketplace name immutability.** A shipped plugin name cannot change without a
   `renames` map, and marketplace renames force remove/re-add on every consumer
   (gstack-and-ecosystem.md pitfall 5). *Mitigation:* D3 (dedicated private repo) and D4
   (marketplace name `gosleep-plugins`) are owner-decided as of 2026-08-15; D1 (packaging
   granularity) and D2 (bundle names) remain owner decisions to take before first install,
   with names chosen for decade-scale comfort.
2. **Reserved marketplace names.** About 16 names are blocked at runtime, and a marketplace
   under a newly-reserved name stops loading (plugin-architecture.md section 7).
   *Mitigation:* `gosleep-plugins` is not on the list and does not impersonate anything;
   re-check the live list at Phase 1.
3. **Dual version definition.** `version` set in both plugin.json and the marketplace entry —
   the manifest silently wins. *Mitigation:* the rule in section 3A.3 (manifest only) plus
   `validate --strict` in the snapshot-release script.
4. **Forgotten version bump = silent staleness.** Content changes without a manifest bump
   never reach installed copies. *Mitigation:* the snapshot-release script is the only
   sanctioned way to change `plugins/`-shipped content, and it always bumps; the web
   "newer snapshot available" indicator (section 5.1) makes staleness visible.
5. **Agent shadowing.** Local `.claude/agents/` definitions override same-named plugin
   agents — the one component where coexistence is NOT symmetric. *Mitigation:* the bundles
   ship zero agents through every near-term phase; if agents are ever added, this risk gets
   its own decision at that time (candidate for a 4B revisit).
6. **Private-repo credential failure on background updates.** Background `git pull` disables
   credential helpers; private HTTPS marketplaces fail silently (plugin-architecture.md
   section 2.4). *Mitigation (relevant per D3-decided: dedicated private repo):* use SSH
   remote for the marketplace (not HTTPS) and set
   `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` so a transient failure does not drop
   the marketplace. Defense in depth: D9 suppresses background auto-update for the gosleep
   marketplace regardless, so a failed background pull never silently changes what is
   installed. Phase 1 verifies the SSH path works end-to-end before Phase 2.
7. **Cache/discovery staleness.** Updates require a session restart; some installs need
   `/reload-plugins` before skills hook up. *Mitigation:* the update runbook (Phase 2
   deliverable) states: update → restart → verify with `claude plugin list`.
8. **Background auto-update surprising a night shift.** Marketplaces refresh on session
   start and plugins update per resolved version. *Mitigation:* D9 — auto-update suppressed
   for the gosleep marketplace (knob verified in Phase 1), version bumps owner-gated, no
   mid-shift updates; defense in depth via pinning.
9. **Layout mistakes.** Components placed inside `.claude-plugin/` are silently invisible;
   the docs call this the top mistake. *Mitigation:* `validate --strict` + the Phase 1
   `--plugin-dir` smoke test actually invoking a skill from each bundle.
10. **Single-skill plugin name fallback.** A single-skill plugin without frontmatter `name`
    takes its name from the install directory — which for marketplace installs is a version
    string that changes every update. *Mitigation:* we use explicit `skills/` directories,
    and every SKILL.md already carries frontmatter `name`.
11. **Snapshot staleness.** Between global edits and the next snapshot release, installed
    pilot bundles run against an older content set than global. In the interim model this
    is by design (snapshots are cut at owner-approved cadence, not on every edit) — the
    risk is only that the owner forgets a snapshot for a long stretch. *Mitigation:* the
    web "newer snapshot available" indicator (section 5.1) surfaces the gap; the
    snapshot-sync script is cheap to run; loose global skills — which are the primary path
    near term — are always live regardless.
12. **The gstack anti-pattern, adopted by accident.** gstack self-updates with `git stash` +
    `git reset --hard` in its install tree — the exact pattern that destroyed live work in
    this repo on 2026-07-13 (gstack-and-ecosystem.md pitfall 2; memory
    no-git-stash-in-shared-tree). *Mitigation:* nothing in this strategy ever auto-pulls or
    resets a working tree; production copies live only in Claude Code's content-addressed
    cache, which no agent hand-mutates.
13. **Inventory incompleteness.** The 5-orphan list is a careful sweep, but only the owner
    can confirm nothing else of his is hiding among the ~138 global entries (or on other
    machines). *Mitigation:* D8 asks explicitly; Phase 0 is additive, so a late-found orphan
    just repeats the same cheap step.

---

## 7. Open questions for the owner

Each with options, our recommendation, and a reversibility note. Numbering (D1-D10) is
preserved from the prior draft for traceability; every decision has been re-checked against
the 2026-08-15 correction (interim snapshot-mirror model near term; inversion and cutover
are far-future, gated on gosleep = full PRODUCTION + separate owner decision).

**D1. Packaging granularity.**
Options: (a) one plugin with all 12 skills; (b) three thematic bundles; (c) 12 per-skill
plugins. *Recommendation:* (b), per section 3A.1. Applies identically to the interim
snapshot-mirror model and the far-future end-state (the packaging shape does not change at
the flip). *Reversibility:* moving a skill between bundles later is cheap (content moves,
versions bump). Renaming/splitting bundles later is the expensive move because plugin names
are immutable (renames map + consumer churn). Decide before first install.

**D2. Bundle composition and naming.**
Options: the section 3A.1 proposal as-is; the same groups with `extra-usage` moved to
`gosleep-orchestration`; different line-drawing entirely; and the name prefix question —
`gosleep-*` (recommended: recognizable, matches the harness story) vs a neutral
`ainstance-*` prefix for cross-project branding. *Recommendation:* the proposal as-is with
`gosleep-*` prefixes. *Reversibility:* free until first install; expensive after (see D1).

**D3. Marketplace home — DECIDED by owner 2026-08-15: dedicated separate private
repository (option b), named per D4-decided.**
Owner's words: "мы сами сделаем отдельный репозиторий для плагинов." The marketplace
lives in a dedicated separate private repository — concretely
`ainstance-labs/gosleep-plugins` (repo name = D4-decided below). Bundles live in that repo,
populated by owner-commanded snapshots from the global truth (direction unchanged:
`~/.claude/skills/` → gosleep `skill/` (owner-commanded sync) → `ainstance-labs/gosleep-plugins`
→ versioned release). Section 3A.2 and all downstream references have been updated to
reflect this decision. *Considered and superseded* — option (a) in-repo `plugins/` and
option (c) start-in-repo-then-graduate; both remain documented in section 3A.2's
trade-off table as reference material only, not as active choices. *Reversibility:* high
— plugin names are unaffected by where they are hosted.
*Trade-offs to know* (documented in the prior discussion, still relevant):
- provenance discipline (GSL-keyed commits, one PR per Epic) is bootstrapped in the new
  repo from zero rather than inherited from gosleep — worth carrying over verbatim.
- private-HTTPS credential-helper failure on background updates
  (plugin-architecture.md section 2.4) is now a real risk: use SSH remotes for the
  marketplace and adopt `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1`
  (D9 update discipline still holds: auto-update is suppressed for the gosleep
  marketplace regardless, so this failure mode is doubly mitigated).

**D4. Marketplace name — DECIDED by owner 2026-08-15: `gosleep-plugins`** (concrete repo
path `ainstance-labs/gosleep-plugins`, matching the org/private-repo pattern used by the
gosleep app repo itself). Reserved-name list re-checked at Phase 1 to confirm no
collision. *Considered and superseded* — `gosleep-skills`, `ainstance-plugins`; both were
viable alternatives, retained here only as decision provenance. *Reversibility:* renaming
a marketplace after installs = remove/re-add on every consumer; effectively decide once —
which is why the decision is being pinned now, before first install.

**D5. Versioning rules.**
Options: (a) semver in plugin.json only, start `0.1.0`, snapshot releases interim, `1.0.0`
reserved for the far-future F2 flip (not for near-term full transition — because there is
no near-term full transition per the 2026-08-15 correction), tags via `claude plugin tag`,
every release owner-gated (recommended, section 3A.3); (b) SHA-pinned marketplace entries
with CI bumps (Anthropic official style). *Recommendation:* (a). *Reversibility:* full —
a scheme change later is a process change, not a breaking change.

**D6. Fate of PR #307 and the CHANGELOG ledger under the snapshot-mirror model.**
Options for the PR: merge as designed (recommended, section 5.2) vs re-scope mid-flight.
Options for the ledger: keep as a shared ledger with rows appended by both `publish.sh`
(owner publish to loose skills) AND `snapshot-sync.sh` (snapshot release), distinguished
by a `kind` field or the target name (recommended, extends the schema additively) vs a
separate ledger per surface. Sub-decisions: extend the schema enum 7 → 12 in Phase 0
(recommended); `plugins/` trees generated from `skill/` during 4A (recommended — the whole
point of the snapshot-mirror model is a one-directional flow from global via `skill/` into
`plugins/`); the question of whether `plugins/` ever becomes hand-editable is a 4B
question, not a 4A question. *Reversibility:* high on every sub-point; the ledger is
append-only history either way.

**D7. `orchestrating-delivery-agents` authority regime — no change through Phase 2;
explicit re-decision at G3 (per skill or per fleet).**
The standing rule says the GLOBAL copy is authoritative. Under the 2026-08-15 correction
this rule stays UNTOUCHED through Phase 2 by construction: global remains the editable
source of truth for every skill in Phase 0/1/2, and snapshot-mirror packaging never
inverts that. The owner-refined sub-plan (4A-G) then asks the specific question for the
migrated 12 at G3: does `orchestrating-delivery-agents` join the trial the same way as the
other 11, or is it kept globally-authoritative even during the trial and archive-moved
last (or never)? Recommended: include it in G1/G2 like the others, but flag G3 as a
per-skill go/no-go check-in for this specific skill given its size (~1497 lines) and
project-lacing. The heavyweight 4B regime flip remains a separate decision beyond both G4
and the production gate. Near-term operational nuance: `snapshot-sync.sh` READS from
`~/.claude/skills/orchestrating-delivery-agents/` — the "never auto-synced" clause in
d-2026-07-20 was about local → global writes via `install.sh`, so a read-only sync does
not violate it; owner may still want the script to require an extra explicit
acknowledgement for this specific skill. *Reversibility:* full through G3 (revert stubs,
resume global editing); G4 rollback for this skill is the same `mv`-back mechanism as any
other.

**D8. Phase 0 scope — the orphans.**
Confirm: (a) reverse-sync the 5 named orphans into `skill/` now, ahead of all architecture
work (recommended); (b) does the owner recall any OTHER owner-authored skills, on this
machine or elsewhere, that the sweep missed? (c) do the orphan skills fold into the bundles
per D2 (recommended: yes, per the section 3A.1 table) or form a separate grouping?
*Reversibility:* total — Phase 0 is an additive repo commit.

**D9. Update discipline for pilot installs (Phase 2) and the G-plan.**
Applies to any bundles installed in Phase 2 or under G1-G4 (Phase 0 and Phase 1 install
nothing; sections 4A and 3A.6 stand). Options: (a) explicit owner-run `claude plugin
update` only, background auto-update suppressed for the gosleep marketplace, no mid-shift
updates (recommended); (b) allow background auto-update and rely on version pinning alone.
*Recommendation:* (a). *Reversibility:* full — this is a settings/process choice,
changeable any time. Note the interaction with D3-decided (dedicated private repo, SSH
remote per risk 6): D9 (a) is doubly justified because a background pull failure would
otherwise silently propagate whatever state the last successful pull left.

**D10. Evidence bar for the far-future 4B ceremony.** The month-trial gate for G3/G4 is
NOT here (it belongs to the G-plan itself, section 4A-G G3) — this decision covers only
the 4B productization gates beyond G4.
What does the owner want to see before agreeing to F1 (cross-project usage cutover), F2
(productized contribution ceremony), and F3 (legacy decommission at scale)? *Hard
precondition on every 4B step (the 2026-08-15 correction):* **gosleep is recognized by
the owner as a full production system** — not the current prototype-under-active-development
state. This is the primary gate; nothing in 4B moves without it. *Proposed additional
baseline* (refine to taste): G4 landed on the owner's machine and observed for a
sustained window beyond the initial ~1-month trial; the productized contribution flow
(another project → PR to plugins repo → CI feedback → merge → release → update) walked
through end-to-end at least once with a real cross-project contribution; for F3
additionally, N weeks with plugin invocation as the primary path across all consumer
machines AND zero reliance on bare-name invocations of the 12. *Recommendation:* adopt
the "gosleep = production" precondition
verbatim and the baseline as a starting point; the owner sets the specifics closer to the
gate. *Reversibility:* not applicable — this defines gates; each of F1/F2/F3 remains a
separate owner decision by the 2026-08-15 directive.

---

## Appendix A — evidence map

| Claim in this strategy | Source |
|---|---|
| Plugin component inventory; manifest schema; only `name` required | plugin-architecture.md section 1; docs `code.claude.com/docs/en/plugins-reference` |
| `installed_plugins.json` provenance fields, verified live | plugin-architecture.md section 3.5 (verbatim file contents from this machine) |
| Version resolution precedence; pinning semantics; dual-definition footgun | plugin-architecture.md section 3.1 |
| `claude plugin update` restart requirement; auto-update background behavior | plugin-architecture.md sections 3.2-3.3 |
| Skill namespacing + coexistence quote; agent shadowing | plugin-architecture.md section 4.1-4.2; gstack-and-ecosystem.md section 2.4 |
| CLI surface (validate / tag / eval / --plugin-dir) | plugin-architecture.md section 5 (live `claude 2.1.233` output) |
| Team distribution via `extraKnownMarketplaces` + `enabledPlugins` | plugin-architecture.md section 6.1 |
| Reserved marketplace names; rename immutability; layout mistake | plugin-architecture.md section 7; gstack-and-ecosystem.md section 4 |
| gstack is NOT a plugin; its update-flow risks | gstack-and-ecosystem.md sections 1, 4 |
| 12-skill inventory; 5 orphans + identification evidence | current-state-and-fit.md sections 1, 1.5 |
| Byte-equality of the 7 post-GSL-251; drift history | current-state-and-fit.md sections 2.2, 4.2 |
| publish.sh / registry / web control plane state | current-state-and-fit.md section 3 |
| CHANGELOG.jsonl = 0 rows; skill/ contents; PR #307 open | disk re-verification this session (2026-08-15) |
| Owner constraints (soft transition, approval-gated, safety rules) | mission brief 2026-08-15; current-state-and-fit.md section 5; project CLAUDE.md |
| Owner correction: source-of-truth inversion moved to far future; snapshot-mirror is the near-term model; loose global stays primary; "gosleep = full production" is the hard 4B precondition | owner chat 2026-08-15 (binding correction reproduced in executive summary Owner corrections block; constraint 4 in section 2.4) |
| Owner refinement: global-scope sub-plan G1-G4 (parallel install → owner-approved deprecation stub → ~1-month trial → owner archive-move); v1 bundles are skills-only; v2 candidates named (MCP server, hooks, subagents/commands); G4 is the lightweight global-scope flip, distinct from the far-future 4B gosleep-as-product ceremony | owner chat 2026-08-15 (reproduced in executive summary Owner refinement paragraph; sections 3C and 4A-G) |
| Owner decision on D3: marketplace lives in a dedicated separate private repository (option b), not in-repo `plugins/` | owner chat 2026-08-15 ("мы сами сделаем отдельный репозиторий для плагинов"); recorded in section 3A.2 header, D3 body, and downstream references throughout |
| Owner decision on D4: marketplace / repository name is `gosleep-plugins` (concrete repo path `ainstance-labs/gosleep-plugins`) | owner chat 2026-08-15; recorded in D4 body, D3 cross-reference, section 3A.2 layout example, and the exec-summary decision list |
