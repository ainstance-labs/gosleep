# PRD — Phase 9: plugin migration, Phase 0 — orphan skill rescue

> **Status:** Draft — 2026-08-15 (per-phase file; near-term half of the plugin-migration program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Epic:** [GSL-334](https://ainstance-labs.atlassian.net/browse/GSL-334) (execution) · Documented under program epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)
> **Design source of truth:** `docs/reports/plugin-migration-research-2026-08-15/strategy.md` sections "Executive summary → Recommended near-term path (1)" + "Section 4A → Phase 0" + `findings/current-state-and-fit.md` section 1.5 (5 orphan positive identification).
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).
> **Alignment note:** GSL-334 is being executed **concurrently tonight** by another worker. This PRD is the recorded requirements/acceptance envelope for that epic. It does not conflict — the two documents describe the same delivery from different angles (PRD = the contract; the epic dev_history = the execution log).

---

## Positioning: end the "one `rm` deletes them forever" exposure before any architecture work

Five owner-authored skills — `agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic` — live **only** under `~/.claude/skills/<name>/` with no repository copy anywhere. Their combined SKILL.md payload is ~91 KB, plus `references/` and `templates/` subtrees for three of them (strategy section 2.1; findings/current-state-and-fit.md section 1.5). Provenance today is "mtime and nothing else, PERIOD" — no git author, no commit trail, no backup on this machine — and a single `rm -rf ~/.claude/skills/<name>` deletes the sole known copy irreversibly.

Phase 9 (= strategy Phase 0) reverse-syncs the five subtrees into the repository at `skill/<name>/`, mirroring the GSL-251 pattern (global → local, owner-sanctioned, read-only against global). The step is **deliberately independent of every other decision in the migration** — packaging (D1), bundle composition (D2), marketplace home (D3-decided), naming (D4-decided), semver rules (D5), CHANGELOG fate (D6), authority (D7), update discipline (D9), 4B evidence (D10) — so it lands the safety net before the plan touches anything mechanical.

**Terminology.** The rescue is a **copy into the repo**, not an inversion of authority. Global `~/.claude/skills/` **remains the editable source of truth** for every skill, tracked or orphan, throughout every near-term phase (owner correction 2026-08-15 — strategy Executive summary Owner corrections point 2). The repo `skill/` is a snapshot mirror. This nuance MUST survive into the CLAUDE.md list edit (see F9-S3 below).

---

## Goal

Every one of the five orphan skills exists in the repository at `skill/<name>/` with the **full subtree** (SKILL.md + `references/` + `templates/` where present) copied byte-equal from `~/.claude/skills/<name>/`. The reverse-sync is proven by an empty `diff -rq` per skill. The Skills changelog schema (`tools/skills/schema/changelog.schema.json`) has its `skill` enum extended additively from 7 to 12 names, and the validator still passes. CLAUDE.md's "Skill source of truth" list reflects the new 12-skill inventory **without** declaring the repository as source of truth for the migrated 12 or for anything else — global remains authoritative per d-2026-07-20. Global was READ-ONLY at every step.

---

## Scope

| In | Out (and why) |
|---|---|
| **Reverse-sync of 5 orphan subtrees.** `agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic` — copied from `~/.claude/skills/<name>/` into `skill/<name>/` with `cp -a` or `rsync -a` (no `--delete` against global). Full subtree per skill, `references/` + `templates/` preserved. | Any write to `~/.claude/skills/**` — global is READ-ONLY for this phase. |
| **Additive schema enum extension** (`tools/skills/schema/changelog.schema.json`) 7 → 12 names, keeping the existing seven entries intact. Ordering: alphabetical or insertion-order — either is fine as long as `tools/skills/validate-changelog.sh` still exits zero on the current (empty) CHANGELOG.jsonl. | Any new CHANGELOG rows — the ledger stays at 0 rows in this phase; Phase 11 (snapshot-release pipeline) is what appends rows. |
| **CLAUDE.md `skill/` list update** — new bullet lines for the five rescued skills; the "source of truth" wording keeps its current meaning (repo tracks the dev copies; global is authoritative) and IS NOT rewritten to imply the repo has become authoritative. | Any edit to the "Safety rules (hard)" block or the `install.sh` guard, both of which are load-bearing and out of scope here. |
| **Per-skill `diff -rq` empty proof** captured in the dev_history file (`docs/dev_history/GSL-334-*.md`) as the byte-equality receipt. | Cross-project promotion (a gsd-* skill or a gstack skill into the repo) — the 5-orphan inventory (findings section 1.5) explicitly excluded all ~126 third-party global entries. |
| **Uncertain-orphan flag.** Findings section 1.5 covered all 138 global entries and identified exactly these 5. The dev_history file records the search criteria + result so a later owner check ("did we miss any?") has a bounded search to re-run. | Additional orphan skills the owner may recall later — those are additive follow-on tickets, not this phase. |

---

## Success criteria

- **F9-S1 (byte-equality).** For each of the five orphans: `diff -rq "$HOME/.claude/skills/<name>/" "skill/<name>/"` produces no output (empty, exit 0). Ignore `.DS_Store` if it appears globally. Receipt is a fenced block in the dev_history file.
- **F9-S2 (schema still validates).** After extending the `skill` enum from 7 to 12 names, `bash tools/skills/validate-changelog.sh` exits 0 against `docs/skills/CHANGELOG.jsonl` (empty JSONL is valid by construction — the file is append-only, no rows means no rows to validate against the schema).
- **F9-S3 (CLAUDE.md nuance preserved).** The updated "Skill source of truth" section lists all 12 skills in `skill/`; the surrounding prose still names global `~/.claude/skills/<name>/` as the editable authoritative surface and reproduces the standing d-2026-07-20 rule verbatim. A `git diff` proves no reworded sentence flipped the authority meaning.
- **F9-S4 (global untouched).** `stat -f '%Sm' ~/.claude/skills/{agentic-report-creator,agentic-scenario-runner,efficient-agent-evals,extra-usage,verifier-skeptic}/SKILL.md` before and after the reverse-sync are identical (or the "after" mtime is `>=` the "before" mtime **only** because another process touched them independently — nothing in this phase writes global). No file under `~/.claude/skills/` was written by this phase.
- **F9-S5 (repo-history receipt).** A commit exists on branch `GSL-334-phase0-orphan-rescue` with message `GSL-334 [Skill][Process] Reverse-sync Phase 0: 5 orphan skills into skill/`, plus one `docs/dev_history/GSL-334-*.md` file per task per project convention. The concurrent Phase 0 epic (GSL-334) is the authoritative execution log; this PRD is the requirements record.

---

## Requirements

- **R9.1 — Global is READ-ONLY.** No `rsync --delete`, no `cp` into `~/.claude/skills/**`, no `install.sh`, no `publish.sh` invocation. The direction of every filesystem operation is `~/.claude/skills/<name>/  →  skill/<name>/`, never the reverse. Acceptance: F9-S4.
- **R9.2 — Full subtree, not just SKILL.md.** Three of the five orphans carry payload beyond SKILL.md: `agentic-report-creator` has `references/` (5 files: `demo.html`, `design-tokens.md`, `example-payload.json`, `i18n-workflow.md`, `rendering.md`) + `templates/`; `agentic-scenario-runner` has `references/case-tasty-lunch-01.md`; `verifier-skeptic` has `references/` (3 files: `findings-schema.md`, `jira-recipes.md`, `pixel-perfect-loop.md`). Missing any of these = the rescue is not complete. Acceptance: F9-S1.
- **R9.3 — Schema enum is additive.** The current `tools/skills/schema/changelog.schema.json` closes the `skill` enum to the seven tracked names. The extension appends five entries (`agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic`) without removing or reordering the existing seven. Acceptance: F9-S2.
- **R9.4 — CLAUDE.md wording preserves authority nuance.** The list of owned skills grows to 12; the surrounding sentences ("`skill/` is the source of truth for **all 12 owned skills**" — same shape as today's "**all 7 owned skills**") still refer to the dev-copy tracking meaning of "source of truth", NOT a claim that the repo has become authoritative for runtime. The standing d-2026-07-20 safety block is unchanged. Acceptance: F9-S3.
- **R9.5 — Dev_history captures search criteria for future re-checks.** The dev_history file names the six identification criteria from findings section 1.5 (frontmatter shape / `(gstack)` suffix / prose style / project references / `gsd-*` prefix / missing-from-disk-elsewhere) and the "138 entries scanned → 5 orphans identified" result, so a later "did the fleet grow?" audit has a bounded procedure. Acceptance: dev_history file present.
- **R9.6 — Isolated worktree.** The rescue commit lands on a fresh worktree from `origin/main` on branch `GSL-334-phase0-orphan-rescue` (verified in git status of the shared tree: no orphan-rescue paths appear). Acceptance: `git worktree list` shows the isolated worktree; the shared tree remains on `GSL-174-skills-management` with unrelated pending work.

---

## Tasks (epic `[Skill][Process] Phase 0: orphan skill rescue`, GSL-334)

Executed by another worker tonight; task list mirrors the description on GSL-334:

1. GSL-334-T1 — copy the 5 skill subtrees into `skill/<name>/` (`agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic`); per-skill `diff -rq` proof empty; schema enum extended 7 → 12; validator still green.
2. GSL-334-T2 — dev_history entries per task (`docs/dev_history/GSL-334-*.md`) + index update; CLAUDE.md skill-list update (12-skill wording, authority nuance preserved per R9.4).

---

## Dependencies

- None. Phase 9 is deliberately independent of every architecture decision. Any follow-on plugin work (Phase 10 bundle authoring, Phase 11 snapshot-release pipeline) assumes the 12-skill tracked inventory as its input, so this phase unblocks all of them.
- Concurrent Phase 8 work continues on branch `GSL-174-skills-management` in the shared tree; Phase 9 uses its own worktree off `origin/main` so the two never conflict.

---

## Non-goals (explicit)

- Any write to `~/.claude/skills/**` — global is READ-ONLY for this phase; every write is repo-side.
- Deleting or moving the global orphan copies — they stay live and authoritative; this phase only makes a backup mirror.
- Any packaging of the rescued skills into plugin bundles — that is Phase 10.
- Any new CHANGELOG row — the ledger stays at 0 rows; snapshot-release rows come from Phase 11's pipeline.
- Any bulk sync via `install.sh` — the guard has been on since 2026-07-20 and stays on.
- Cross-project skill promotion (gsd-*, gstack) — out of migration scope per findings section 2.3.
- Editing `orchestrating-delivery-agents` — under d-2026-07-20 the global copy is authoritative; only the owner edits it. Phase 9 does not touch it; the reverse-sync happened at GSL-251 (2026-08-10).

---

## Risks + open questions

- Risk 1 — **someone reads "reverse-sync" as "inversion"** and rewrites CLAUDE.md to declare the repo authoritative. Mitigation: R9.4 spelt out; F9-S3 verifies the wording; the skeptic pass hunts for it.
- Risk 2 — **the sole known copy assumption is wrong** and one of the 5 skills lives on another machine of the owner's. Mitigation: findings section 1.5 flagged this uncertainty explicitly (D8 in strategy section 7). Phase 9's reverse-sync is additive, so a later-found backup elsewhere costs nothing.
- Risk 3 — **inventory incompleteness** (a 6th owner-authored orphan was missed). Mitigation: dev_history records the search criteria + 138-entry sweep so a later re-run is bounded (R9.5). A late-found orphan just repeats the same cheap step.
- Risk 4 — **`.DS_Store` noise** producing false `diff -rq` output. Mitigation: the byte-equality assertion (F9-S1) can pipe through `grep -v '\.DS_Store'`, matching the pattern already used in findings section 2.2.
- Risk 5 — **schema enum extension breaks other consumers** if `validate-changelog.sh` runs against an old JSONL that expected 7 names. Not a real risk today (CHANGELOG.jsonl is 0 rows), but state it in the dev_history so a later reader knows the enum extension is safe by construction with an empty ledger. Acceptance: F9-S2.

Open questions (recommended defaults for tonight):

- Q1. Does `orchestrating-delivery-agents` count as an orphan needing "re-rescue"? → **default:** no. GSL-251 already reverse-synced it 2026-08-10 (verified byte-equal 2026-08-15). The five in this phase are strictly the ones that were never in `skill/`.
- Q2. Does the schema enum extension need a separate ticket? → **default:** no — bundle it into T1 so the reverse-sync and its schema consequence land in one commit.

---

## Sources

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — Executive summary Owner corrections + Recommended near-term path (1) + section 4A Phase 0.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — sections 1.5 (positive identification of the 5 orphans + identification criteria), 2.3 (~138 global entries, gstack/gsd-* out of scope).
- `CLAUDE.md` — "Skill source of truth" section (7-skill layout that this phase extends to 12).
- `tools/skills/schema/changelog.schema.json` — closed enum of 7 names that this phase extends to 12.
- `tools/skills/validate-changelog.sh` — validator that must stay green after the enum edit.
- `install.sh` — the guard that keeps the bulk-sync path disabled; unchanged here.
- Concurrent execution log — Jira `GSL-334` + `docs/dev_history/GSL-334-*.md` (written by the executing worker tonight).

---

*End of Phase 9 PRD.*
