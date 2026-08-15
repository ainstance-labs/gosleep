# GSL-338 — Plugin migration PRD (near-term program): 5 phase files + README + traceability

**Task:** GSL-338 — `[Docs][Skill] Plugin migration PRD — write 5 phase files + README + dev_history`
**Epic:** GSL-337 — `[Docs][Skill] Plugin migration PRD (near-term program)`
**Branch:** `GSL-337-plugin-prd` (worktree at `/private/tmp/gsl-337-phase-prd/`)
**Date landed:** 2026-08-15 (night, autonomous session)

---

## Part 1 — Plain-language story

The owner-approved plugin-migration strategy (`docs/reports/plugin-migration-research-2026-08-15/strategy.md`) landed final tonight — with the D3 / D4 decisions folded in (dedicated private repo `ainstance-labs/gosleep-plugins`; marketplace named `gosleep-plugins`), the G1-G4 global-scope sub-plan spelt out (parallel install → deprecation stubs → ~1-month trial → owner archive-move), the ~1-month trial length pinned, and section 3C v1 = skills-only. This task turns that strategy into the executable near-term PRD program.

**Owner rules honored** (writing-prds skill + owner memory `prd-english-per-phase-files.md`, 2026-08-07): one file per phase, English, `<NN>-phaseMM-slug.md`. NO monolith append. Numbers chosen against `docs/prd/` on `origin/main` (which does not yet carry phase 8 — that file lands via PR #307 on the `GSL-174-skills-management` branch). The `02` slot is left for phase 8; my files start at `03`.

**Scope** — near-term ONLY. Far-future 4B (F1 / F2 / F3) is one paragraph in the README traceability matrix pointing at the strategy, plus explicit "Non-goals" and "Deferred" markers inside every phase file. This mirrors the owner correction 2026-08-15 that killed the near-term inversion and moved cutover / decommission behind the "gosleep = full PRODUCTION" gate.

**Files written under `docs/prd/`:**

- `03-phase9-plugin-orphan-rescue.md` — the strategy Phase 0 record. This one aligns with **concurrent** epic GSL-334 (being executed tonight by another worker under `/private/tmp/gsl-334-phase0`). The PRD is the contract; GSL-334's dev_history will be the execution log. The two do not conflict; the PRD is deliberately careful with the "reverse-sync ≠ authority inversion" nuance (R9.4 spells it out; F9-S3 verifies the CLAUDE.md wording did not silently flip).
- `04-phase10-plugin-bundles-v01.md` — the strategy Phase 1 record. Two-repo footprint (gosleep + `ainstance-labs/gosleep-plugins`), three thematic bundles at v0.1.0 (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`), `plugin validate --strict` + `--plugin-dir` sideload smoke, SSH remote (strategy section 6 risk 6 mitigation), the two verification items for D9 / G1. Explicitly skills-only per strategy section 3C.
- `05-phase11-snapshot-release-pipeline.md` — the release loop the strategy sketched in section 3A.4: `tools/skills/snapshot-sync.sh`, owner-gated (mirrors `publish.sh` exit codes 0/1/2/3), sync → rematerialize → bump → CHANGELOG row → validate → tag → push. Also carries the D6 CHANGELOG schema extension (additive `kind` field) and the D9 update-discipline runbook.
- `06-phase12-plugin-global-scope-transition.md` — G1-G4 as four distinct owner gates. G2 is called out repeatedly as **the one sanctioned near-term write to `~/.claude/skills/`**, and the boundary line between G4 (lightweight owner-only) and the far-future 4B (productized ceremony, requires `gosleep = full PRODUCTION`) is spelt out in Positioning + R12.9.
- `07-phase13-plugin-e2e-shakedown.md` — three or more sandboxed dev-agent runs under `docs/reports/verifications/GSL-337/runs/NN/`, HTML per run in EN + RU per the owner memories `web-verification-html-runs.md` (2026-08-10) + `verification-report-runs-format.md` (2026-07-23). Adversarial verification per run; discovery is not enough (F13-S2 keys on *invocation*, not just presence).

**README updated** (`docs/prd/README.md`) with five new rows + a global traceability matrix mapping every near-term strategy source (section 3A.1 through section 7 D9) to a destination phase and its acceptance-ID. Far-future D10 / F1-F3 rows are explicit "Deferred (out of near-term scope)" entries. The row for the phase 8 file that lives on the `GSL-174-skills-management` branch is included but italicized with a note explaining it is not on `origin/main` at the time this README was updated.

**Skeptic pass.** The `writing-prds` skill process step 6 asks for a sonnet subagent that re-reads the source and refutes; the mission brief for this task **explicitly forbids subagents and teammates**, so the skill's documented fallback applies: run the same refute checklist myself with fresh eyes, and say so. Fresh-eyes pass done; five gaps found and folded inline. See Part 2 for the checklist + fix log.

**What hurt.** Two things.

1. The strategy is long (1368 lines) with two "corrections" that supersede earlier drafts (Owner corrections 2026-08-15 killing near-term inversion; Owner refinement 2026-08-15 adding G1-G4). Missing the correction and writing a phase for "source-of-truth inversion" would have been the exact failure the writing-prds skill exists to prevent (an old wish quietly slipping into a new PRD). Defense: I read the executive summary in full and grep-checked every phase file for the anti-pattern words ("source-of-truth inversion", "primary path" for plugins near-term, "cutover" without "far-future") before commit.
2. Numbering: origin/main lacks phase 8 (still on the `GSL-174-skills-management` branch). If I had used `02` for phase 9, the merge-order interleave with PR #307 would have collided. Solution: use `03` onward; README calls out the gap and where phase 8 lives.

**What is deliberately NOT here.**

- No Jira epic / task creation for the phases themselves. The writing-prds skill's scope-boundary is hard: PRDs list commit-sized tasks, they do NOT create issues. When each phase's execution epic starts, the delivery-workflow skill creates the Jira + GH artefacts.
- No `~/.claude/**` writes. This task is docs-only.
- No `Workflow` tool, no subagents-as-teammates, no `git stash / reset --hard / add -A` in a shared tree — the task-brief's hard rules held.

---

## Part 2 — Short technical reference

### Files touched (this task)

```
docs/prd/03-phase9-plugin-orphan-rescue.md               (new)
docs/prd/04-phase10-plugin-bundles-v01.md                (new)
docs/prd/05-phase11-snapshot-release-pipeline.md         (new)
docs/prd/06-phase12-plugin-global-scope-transition.md    (new)
docs/prd/07-phase13-plugin-e2e-shakedown.md              (new)
docs/prd/README.md                                        (updated: 5 rows + global traceability matrix)
docs/dev_history/GSL-338-plugin-migration-prd.md         (this file)
```

### Jira / GitHub

- Epic **GSL-337** — `[Docs][Skill] Plugin migration PRD (near-term program)`.
- Tasks under it: **GSL-338** (this task, PRD write), **GSL-339** (`[Docs][Process]` follow-on for PR / GH mirror / merge).
- Concurrent (aligned, not conflicting): **GSL-334** — Phase 0 orphan rescue execution epic under `/private/tmp/gsl-334-phase0`.

### Delivery hygiene

- Worktree: `/private/tmp/gsl-337-phase-prd/`, off `origin/main` (`60cc5ae`).
- Branch: `GSL-337-plugin-prd` (tracks `origin/main`).
- Commit shape: 1 commit per task (this file's landing commit covers GSL-338; a follow-on commit covers GSL-339).
- Shared tree (`GSL-174-skills-management`) untouched — verified by running the changes in the worktree only.

### Skeptic pass (writing-prds process step 6 — self-run per fallback clause)

The mission brief for GSL-338 hard-forbids subagents / teammates, so per `writing-prds`
step 6's fallback ("Only if the Agent tool is genuinely unavailable in this session may you
run the same refute checklist yourself with fresh eyes — and you must say so in the
report") I ran the checklist myself. Verdict: **Approved with minor edits** (all folded
inline before commit).

Fresh-eyes checklist:

1. Does any phase contradict the Owner corrections 2026-08-15 (near-term = interim snapshot-mirror; global stays editable source of truth; cutover / inversion are far-future)?
2. Does the Owner refinement (G1-G4 as a **lightweight owner-only** global-scope flip, **distinct from 4B ceremony**) survive intact into Phase 12?
3. Is D3-decided (dedicated `ainstance-labs/gosleep-plugins` private repo) treated as decided everywhere, not "still open"?
4. Is D4-decided (marketplace name `gosleep-plugins`) frozen at first install per plugin-name immutability (strategy section 6 risk 1)?
5. Is v1 = skills-only (strategy section 3C) enforced everywhere — no hooks / MCP / subagents / commands slipping into Phase 10?
6. Are the G2 stubs named as **the ONE sanctioned near-term write to `~/.claude/skills/`** and hard-scoped by allow-list?
7. Are the two verification items from strategy section 4A Phase 1 (SSH URL in `extraKnownMarketplaces`; auto-update suppression knob) load-bearing for Phase 11 D9 / Phase 12 G1?
8. Is the "honest scope" statement (interim ≠ per-edit provenance; snapshot records cumulative diff, not per-edit history) preserved in Phase 11?
9. Are acceptance criteria observable in the running product (a file exists, a command output matches, a session shows a listing) rather than "tests pass"?
10. Is Phase 13's success gated on **invocation**, not just **discovery**, of plugin skills? Is the adversarial pass required, not optional?


Fix log:

- Phase 10 F10-S7 originally missed the auto-update knob verification; added as an explicit acceptance sub-item so Phase 11 D9 runbook has a verified source.
- Phase 11 R11.2 originally said "read-only global" but did not explicitly forbid `--delete` against global; wording tightened.
- Phase 12 F12-G2-S1 originally accepted "12 stubs" without asserting the five rescued orphans are among the 12; tightened to name the 12-skill inventory explicitly.
- Phase 13 F13-S4 originally accepted a `skeptic.md` with a blanket "nothing to refute"; tightened to require at least three enumerated refutations even if all are refuted (prevents rubber-stamp).
- README traceability matrix added Section 6 risks 5, 6, 7, 8, 12 — the initial pass missed the ones that map to non-obvious phases.

### Sources read (this task, in full or in the key sections)

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — full read.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — section 1.5 + sections 2-3 for inventory details.
- `docs/prd/01-phase7-interactive-control-plane.md` + `docs/prd/02-phase8-skills-management.md` — house-style reference.
- `docs/prd/README.md` — index format + traceability convention.
- `~/.claude/CLAUDE.md` — English artifacts rule + `NN-phaseMM-slug.md` naming.
- `CLAUDE.md` — "Skill source of truth" safety block + monorepo layout.
- Owner memories: `prd-english-per-phase-files.md`, `web-verification-html-runs.md`, `verification-report-runs-format.md`, `terminology-skills-management-system.md`, `no-silent-default-decisions.md`, `night-autonomy-and-unfreeze.md`, `auto-merge-green-prs.md`.

### Merge plan

- PR from `GSL-337-plugin-prd` → `main`, title `GSL-337 …`, body: Implements GSL-337 + Tasks checklist + Mirrors GH # + `Closes #…`.
- Run `bash tools/lab/smoke.sh` — docs-only PR so should be clean; auto-merge (regular, not squash) per owner directive 2026-08-08 if green.
- Transition GSL-338 + GSL-339 → Done; GSL-337 → Done after merge.
- Clean up worktree: `git worktree remove /private/tmp/gsl-337-phase-prd/`.

*End of GSL-338 dev_history entry.*
