# PRD — Phase 10: plugin bundles v0.1.0 in `gosleep-plugins` (Phase 1)

> **Status:** Draft — 2026-08-15 (per-phase file; near-term half of the plugin-migration program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)
> **Design source of truth:** `docs/reports/plugin-migration-research-2026-08-15/strategy.md` sections 3A.1 (packaging granularity, three thematic bundles) + 3A.2 (marketplace home — D3-decided) + 3A.3 (semver rules — D5) + section 4A Phase 1 + section 6 risks 1, 2, 6, 9, 10.
> **Dedicated repository:** `ainstance-labs/gosleep-plugins` (private) — D3 + D4 decided by owner 2026-08-15.
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).
> **Alignment note:** the `ainstance-labs/gosleep-plugins` repo is being **stood up tonight** by a concurrent worker (owner sets up the empty private repo; agents clone it locally and populate it). This PRD is the recorded requirements/acceptance envelope for the "bundles v0.1.0" delivery. Snapshot-release tooling (`snapshot-sync.sh`, semver bumps, tags) is a separate downstream PRD (Phase 11) so v0.1.0 authoring is not coupled to the release-loop implementation.

---

## Positioning: give the migration a real packaging artefact to point at, with zero installs

Strategy section 3A.1 recommends packaging the 12 owner-authored skills as **three thematic bundles** (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`) — see composition in R10.2 below. Strategy section 3A.2 header records the owner's 2026-08-15 answer on D3: the marketplace lives in a **dedicated separate private repository** — concretely `ainstance-labs/gosleep-plugins` (D4-decided, same date). This phase materializes both decisions once, end-to-end, at initial version `0.1.0` per bundle (D5 — semver in `plugin.json` only, `1.0.0` reserved for the far-future 4B productization).

Phase 10 packages, validates, and sideload-smoke-tests the bundles. It **installs nothing** — no user-scope install, no `.claude/settings.json` edit, no `claude plugin install` command. The pipeline runs `claude plugin validate --strict` and `claude --plugin-dir <path>` to prove a skill in each bundle actually resolves under the plugin loader, and that is the whole delivery. Distribution comes at Phase 12 (G1). Ongoing release cadence comes at Phase 11.

**Two-repo footprint.** Work spans (a) the gosleep repo (where the source `skill/` trees live and any bootstrap script for populating the plugins repo lives) and (b) the dedicated `ainstance-labs/gosleep-plugins` repo (where the marketplace + three bundle trees live, with their own GSL-keyed commit history bootstrapped from zero — strategy section 3A.2 consequence note). Both repos have owner-approved private status; both use SSH remotes (strategy section 6 risk 6 mitigation).

---

## Goal

The dedicated private repository `ainstance-labs/gosleep-plugins` exists at HEAD with the layout of strategy section 3A.2: a valid `.claude-plugin/marketplace.json` naming `gosleep-plugins` and listing three relative-path plugin sources, plus three plugin directories (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`) each carrying a `.claude-plugin/plugin.json` (name + `version: 0.1.0`) and a `skills/` root populated by copies of the 12 owner-authored SKILL.md trees per the composition table (R10.2 below). `claude plugin validate --strict` returns clean on every bundle. A sideload smoke — `claude --plugin-dir <plugins-repo>/gosleep-delivery` (or an equivalent invocation) — proves a plugin-namespaced skill (e.g. `gosleep-delivery:handoff`) is discovered by the loader. `~/.claude/**` was NOT written by any step in this phase.

---

## Scope

| In | Out (and why) |
|---|---|
| **Bootstrap of the `ainstance-labs/gosleep-plugins` repo** — clone the empty private repo the owner created, add `README.md` (English, one-paragraph what/why + pointer to the strategy in gosleep), `LICENSE` if the owner opts in, `.gitignore` (macOS + node), a `CLAUDE.md` copy of the load-bearing safety block (agents never write `~/.claude/**`; GSL-keyed commits; one commit per Task; Epic+Task hierarchy). | Any migration of GSL-337-era commits into the new repo — its history bootstraps from zero, per strategy section 3A.2 consequence note. |
| **Top-level `.claude-plugin/marketplace.json`** naming `gosleep-plugins` (D4-decided; reserved-list re-checked at execution time — strategy section 6 risk 2) and listing three relative-path sources. | Any GitHub/URL source form — the marketplace uses local relative-path sources through this phase; a later G1 step (Phase 12) is what the owner runs `claude plugin marketplace add` against, and the repo path becomes the source at that point. |
| **Three plugin trees at v0.1.0** — `gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`. Each has `.claude-plugin/plugin.json` (`name`, `version: 0.1.0`, optional `description`), a top-level `skills/` directory (NOT inside `.claude-plugin/` — strategy section 6 risk 9), and copies of the appropriate SKILL.md subtrees (including `references/` and `templates/` where present). Composition per R10.2. | Any agents / hooks / MCP servers / commands / bundled binaries — v1 is **skills only** by owner refinement (strategy section 3C). v2 candidates (MCP server for gosleep-core, cross-project hooks, verifier subagent) are named in section 3C and explicitly out of scope here. |
| **Validation gate** — `claude plugin validate --strict` on every bundle passes; output captured in the dev_history file. | CI wiring in the plugins repo — no CI on either repo yet (project convention); the validate step runs locally, receipt goes in dev_history. |
| **Sideload smoke** — `claude --plugin-dir <plugins-repo>/gosleep-delivery` (or per plugin) is invoked once; the transcript proves `gosleep-delivery:handoff` (or an equivalent plugin-namespaced skill) is listed by the skill discovery loop. Same for one skill per bundle. | Owner-scope install (`claude plugin marketplace add` / `claude plugin install`) — Phase 12 (G1). |
| **Two verification items** (strategy section 4A Phase 1 asks these live-checks before Phase 2/G1): (a) does `extraKnownMarketplaces` accept an SSH URL to `ainstance-labs/gosleep-plugins` cleanly (no settings.json edit — command line probe only); (b) what is the exact auto-update suppression knob for `claude 2.1.233` (candidate: `disableAutoUpdate`, `pluginRefreshFrequency`, or an equivalent per gstack-and-ecosystem findings). Findings captured in the dev_history file so Phase 12 (G1) and Phase 11 (D9) can build on verified facts. | Actual settings.json wiring — deferred to Phase 12 G1 (owner runs the install commands). |
| **Bundle composition freeze** — the three-bundle line-drawing (R10.2 below) is committed to `plugin.json` `name` fields and thus **immutable in place** for the lifetime of the deployed marketplace (renames map + consumer churn per strategy section 6 risk 1). | Regrouping skills between bundles later (cheap — content moves, versions bump) is explicitly OK and does not need to be pre-locked here. Only the BUNDLE names are frozen by this phase. |

---

## Success criteria

- **F10-S1 (marketplace loads).** The dedicated repository at HEAD has `.claude-plugin/marketplace.json` (`name: gosleep-plugins`) listing three plugin sources; `claude plugin validate --strict` on the marketplace returns exit 0.
- **F10-S2 (bundle validation).** Each of the three bundle directories (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`) has `.claude-plugin/plugin.json` with `name` (kebab-case, matches directory), `version: 0.1.0` (strategy section 3A.3), and passes `claude plugin validate --strict <bundle-path>` with exit 0.
- **F10-S3 (skill trees intact).** `find <bundle>/skills -name SKILL.md | sort` lists exactly the SKILL.md files expected per R10.2. For skills with `references/` or `templates/`, `find <bundle>/skills/<name>` reproduces every file present at the source `skill/<name>/`. Dev_history captures a `diff -rq skill/<name>/ <plugins-repo>/<bundle>/skills/<name>/` empty proof per skill.
- **F10-S4 (layout not upside-down).** `.claude-plugin/` contains ONLY `plugin.json`; `skills/` sits at the bundle root, not inside `.claude-plugin/`. (Strategy section 6 risk 9: the docs' top runtime pitfall is exactly this.) Verified by `find <bundle> -maxdepth 3 -type d`.
- **F10-S5 (sideload smoke).** `claude --plugin-dir <plugins-repo>/gosleep-delivery` (or the equivalent flag on `claude 2.1.233`) launches a Claude Code session in which the `gosleep-delivery:handoff` skill is listed under `/skills` output (or equivalent skill listing surface); same probe for one skill per bundle (`gosleep-orchestration:remote-control`, `gosleep-evals:verifier-skeptic`). Transcript excerpt captured in the dev_history file.
- **F10-S6 (`~/.claude/**` untouched).** `stat -f '%Sm' ~/.claude/plugins/installed_plugins.json` before and after Phase 10 shows no phase-induced write. No `claude plugin install` or `claude plugin marketplace add` command was invoked during this phase.
- **F10-S7 (verification items answered).** The dev_history records: (a) whether `extraKnownMarketplaces` accepts an SSH URL to `ainstance-labs/gosleep-plugins` (probed via the smallest possible command that does NOT edit settings — for example `claude plugin marketplace list` after a scratch `--settings` file, or the documented CLI surface). (b) The exact CLI/settings knob for background auto-update suppression on `claude 2.1.233`. Both answers are needed as prerequisites for Phase 11's D9 stance and Phase 12's G1 execution.

---

## Requirements

- **R10.1 — Two-repo separation.** All plugin content, `marketplace.json`, and bundle manifests live in `ainstance-labs/gosleep-plugins`. The gosleep repo carries the `skill/` source trees (unchanged), the strategy document, this PRD, and any optional bootstrap helper (e.g. a one-shot `tools/skills/bootstrap-plugins-repo.sh` that copies from `skill/` into a local checkout of the plugins repo). No `plugins/` directory is created inside gosleep. Acceptance: F10-S1, F10-S3.
- **R10.2 — Bundle composition per strategy section 3A.1** (D2 recommendation, `extra-usage` inside `gosleep-evals`):

  | Bundle | Skills | Rationale |
  |---|---|---|
  | `gosleep-delivery` | `delivery-workflow`, `using-jira`, `writing-prds`, `handoff` | Delivery conventions an agent needs to ship work against Jira+GitHub; evolve together. |
  | `gosleep-orchestration` | `orchestrating-delivery-agents`, `tmux-agents-orchestration`, `remote-control` | Running and steering a fleet; the owner-facing control surface of a live shift. |
  | `gosleep-evals` | `agentic-scenario-runner`, `efficient-agent-evals`, `verifier-skeptic`, `agentic-report-creator`, `extra-usage` | Measurement, verification, reporting, and spend policy; `verifier-skeptic` explicitly consumes `agentic-report-creator` via its frontmatter, so they belong together. |

  If the owner overrides D2 at execution time (moving `extra-usage` to `gosleep-orchestration` is explicitly the second-most defensible line per strategy section 3A.1), the override is recorded in the dev_history under a "D2 override" note and the manifest reflects it — the PRD does NOT re-open otherwise. Acceptance: F10-S3.
- **R10.3 — Semver in `plugin.json` only.** Every `plugin.json` sets `version: "0.1.0"`. The marketplace.json entries do NOT set `version` on any entry (strategy section 3A.3 rule 1 — the documented dual-set footgun: manifest silently wins over marketplace entry). Acceptance: F10-S1, F10-S2 (validator catches inconsistency).
- **R10.4 — Layout discipline.** `.claude-plugin/` at each bundle root contains ONLY `plugin.json`. `skills/` sits at the bundle root. Every skill's `SKILL.md` retains its native frontmatter `name` field (single-skill fallback footgun mitigation — strategy section 6 risk 10). Acceptance: F10-S4.
- **R10.5 — `orchestrating-delivery-agents` inclusion is a READ-only copy** from the current gosleep `skill/orchestrating-delivery-agents/` (already byte-equal to global per GSL-251, verified 2026-08-15). The bundle carries the full subtree including `references/` (`lifecycle-and-edge-cases.md`, `re-wake-brief.md`, `worker-cycle-template.md`). This copy in the plugins repo does NOT modify the standing d-2026-07-20 rule that the GLOBAL copy is authoritative — Phase 10 is packaging, not authority flip. Acceptance: F10-S3; R10.9 below explicitly names the authority nuance.
- **R10.6 — `~/.claude/**` is READ-ONLY for this phase.** No `claude plugin install`, `claude plugin marketplace add`, `claude plugin update`, or manual write to `~/.claude/plugins/*` or `~/.claude/skills/*`. Reads for the sideload smoke via `--plugin-dir` are OK (that flag points at the plugins repo working tree, not at the plugin cache). Acceptance: F10-S6.
- **R10.7 — Validation is not optional.** Every bundle passes `claude plugin validate --strict`; failures block the commit that would ship the bundle. The validator is the same one Anthropic's community pipeline runs — no bespoke checker. Acceptance: F10-S2.
- **R10.8 — Sideload smoke is not optional.** For each bundle, the `--plugin-dir` sideload proves at least ONE skill from the bundle is discovered under its plugin-namespaced form (`plugin-name:skill-name`) — the coexistence-with-loose-skills fact from strategy section 1.4 makes the smoke non-destructive; loose global skills stay callable at their bare names in the same session. Acceptance: F10-S5.
- **R10.9 — Authority nuance survives the packaging.** The plugins repo `README.md` and `CLAUDE.md` state plainly: through Phase 12 G3, GLOBAL `~/.claude/skills/` remains the editable source of truth for the 12 skills; the plugins repo trees are a **snapshot mirror**, populated by the (Phase 11) `snapshot-sync.sh` from gosleep's `skill/`, which is in turn a snapshot of global. No sentence in the plugins repo asserts the repo is authoritative during Phases 10/11 or the G1/G2 sub-steps. Acceptance: text diff review.
- **R10.10 — SSH remote for the plugins repo.** Strategy section 6 risk 6 mitigation: use SSH remote (`git@github.com:ainstance-labs/gosleep-plugins.git`), not HTTPS. Reason: background `git pull` disables credential helpers and a private-HTTPS marketplace would fail silently. Acceptance: dev_history records `git remote -v`.

---

## Tasks (parent epic `[Docs][Skill] Plugin migration PRD (near-term program)`, GSL-337; execution ticket to be filed separately when Phase 10 build begins)

Phase 10 build is not part of this PRD-write epic; the tasks below are the **commit-sized items a future GSL-3xx execution epic should carry** (per PRD scope-boundary rule: PRDs list, do not create). Reproduced here so the execution ticket has an unambiguous target list.

1. `[Skill][Tooling]` — bootstrap the `ainstance-labs/gosleep-plugins` repo (README + LICENSE + `.gitignore` + CLAUDE.md safety block, SSH remote), commit `GSL-3xx repo skeleton`.
2. `[Skill][Tooling]` — write `.claude-plugin/marketplace.json` at the repo root, name `gosleep-plugins`, three relative-path plugin sources, no per-entry `version`.
3. `[Skill][Docs]` — author the three `.claude-plugin/plugin.json` manifests (v0.1.0 each), one commit per bundle.
4. `[Skill][Tooling]` — copy the SKILL.md subtrees per R10.2 into each bundle's `skills/` directory (from gosleep's `skill/`, byte-equal), one commit per bundle. Optional bootstrap helper in gosleep at `tools/skills/bootstrap-plugins-repo.sh` (thin wrapper around `rsync -a --no-perms`).
5. `[Skill][Tooling]` — `claude plugin validate --strict` on each bundle + marketplace; append receipts to dev_history.
6. `[Skill][Tooling]` — sideload smoke via `claude --plugin-dir <bundle>` for at least one skill per bundle; capture transcript excerpts in dev_history.
7. `[Skill][Docs]` — the two verification items (SSH URL in `extraKnownMarketplaces`; auto-update suppression knob on `claude 2.1.233`); dev_history writes the findings under a "Verification items for D9 / G1" heading.
8. `[Skill][Docs]` — README + CLAUDE.md in the plugins repo state the R10.9 authority nuance verbatim.

---

## Dependencies

- Phase 9 (orphan rescue, GSL-334) MUST have landed. The bundle composition (R10.2) needs all 12 SKILL.md subtrees present in gosleep's `skill/` before the copy step can produce byte-equal bundle trees.
- Owner has created the empty `ainstance-labs/gosleep-plugins` repo (D3 execution — the owner's action, not an agent's). If the repo does not yet exist, block on that; do not create it as an agent.
- `claude` CLI at least 2.1.233 (strategy section 1.2 verified feature set: `plugin validate --strict`, `plugin tag`, `plugin eval`, `--plugin-dir`).
- SSH access to `ainstance-labs/gosleep-plugins` from the executing agent's environment (owner's laptop keys).

---

## Non-goals (explicit)

- Any owner-scope install (`claude plugin install`) — Phase 12 (G1).
- Any snapshot-release automation (`snapshot-sync.sh`, semver bumps beyond v0.1.0, `claude plugin tag`, CHANGELOG rows) — Phase 11.
- Any hooks, MCP servers, subagents, commands, or bundled binaries — v1 is **skills only** (strategy section 3C).
- Any write to `~/.claude/**` from any step.
- `.claude/settings.json` edits inside either repo — Phase 12 G1 is where marketplaces get registered.
- The "skills-directory plugin" shortcut (dropping a `.claude-plugin/plugin.json` into each existing `~/.claude/skills/<name>/`) — strategy section 3A.2 explicitly rejects it (it would require writing into the live global tree, violating the standing safety rule).
- Any change to the loose global skill files under `~/.claude/skills/`.
- Renaming the bundles later — plugin `name` is immutable once shipped (strategy section 6 risk 1); post-v0.1.0 rename requires a `renames` map + consumer churn.

---

## Risks + open questions

Consolidated from strategy section 6 (risks with immediate bite in Phase 10 authoring):

- Risk 1 — plugin/marketplace **name immutability**. `gosleep-plugins` (D4-decided) and the three bundle names are locked at first shipping tag. Mitigation: names chosen for decade-scale comfort; reserved-list re-checked (strategy section 6 risk 2) at execution time before the first tag.
- Risk 2 — reserved marketplace names shift (~16 blocked at runtime; a marketplace under a newly-reserved name stops loading). Mitigation: at execution time, re-check the current reserved list against `gosleep-plugins`.
- Risk 3 — dual version definition (`version` in both `plugin.json` and marketplace entry, manifest silently wins). Mitigation: R10.3 forbids per-entry `version` in `marketplace.json`; `validate --strict` catches divergence.
- Risk 4 — layout mistakes (`skills/` accidentally inside `.claude-plugin/`, or the single-skill fallback taking the install-dir path as the plugin name). Mitigation: R10.4; frontmatter `name` present on every SKILL.md.
- Risk 5 — SSH auth not configured on the executing agent's environment. Mitigation: bootstrap step verifies `git ls-remote origin` before any commit; if the auth is missing, block and hand back to the owner.
- Risk 6 — sideload smoke expects `--plugin-dir` behavior verified on `claude 2.1.233`; if the flag surface changed, use the documented alternative from plugin-architecture findings section 4.4. Mitigation: dev_history records the exact command used.
- Risk 7 — the orphan-rescue commit (Phase 9) may still be landing when Phase 10 begins. Mitigation: Phase 10 explicitly depends on Phase 9's HEAD; run `git log skill/<name>/SKILL.md` for each of the 5 orphans to prove presence before starting.

Open questions (recommended defaults for the execution ticket):

- Q1. Include `description` field in each `plugin.json`? → **default:** yes, one-line English matching the bundle rationale table in R10.2.
- Q2. Include a top-level `README.md` per bundle? → **default:** yes, one-liner + link back to the strategy doc.
- Q3. Sideload smoke coverage: one skill per bundle or every skill? → **default:** one per bundle for v0.1.0; broaden in Phase 13 E2E shakedown.
- Q4. D2 override (move `extra-usage` to `gosleep-orchestration`)? → **default:** no; keep it in `gosleep-evals` per strategy section 3A.1 recommendation.

---

## Sources

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — sections 1.2 (delta table), 1.3 (`installed_plugins.json` provenance), 1.4 (namespaced coexistence), 3A.1 (three thematic bundles + composition), 3A.2 (D3-decided dedicated repo + D4 name), 3A.3 (semver rules D5), 3C (v1 skills-only + v2 candidates), section 4A Phase 1, section 6 risks 1-2-6-9-10, section 7 D1-D10.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — sections 1 (7 tracked), 1.5 (5 orphans), 3 (`~/.claude/plugins/installed_plugins.json` extant with 3 installs; 2 marketplaces).
- `CLAUDE.md` — "Skill source of truth" section (updated to 12 skills in Phase 9); safety rules (hard); monorepo layout.
- `~/.claude/CLAUDE.md` — English artifacts rule.
- `install.sh` — verbatim guard (stderr banner + `exit 1` before `rsync`); unchanged.
- Public docs referenced by findings: `code.claude.com/docs/en/plugins-reference` (`.claude-plugin/plugin.json` schema, `marketplace.json` schema, layout rules, `--plugin-dir`, `plugin validate --strict`, `plugin tag`).

---

*End of Phase 10 PRD.*
