# GSL-349 — Observer-mode PRD: README traceability + parent-monolith pointer

**Task:** GSL-349 — `[Docs][Web] Observer-mode PRD: README traceability + parent-PRD pointer`
**Epic:** GSL-347 — `[Docs][Web] Observer-mode PRD (phases A-C)`
**Branch:** `GSL-347-observer-mode-prd` (worktree at `.claude/worktrees/obs-prd/`)
**Date landed:** 2026-08-16

---

## Part 1 — Plain-language story

Sibling task GSL-348 wrote the three per-phase files (`08-phase14`, `09-phase15`, `10-phase16`). This task wires them into the index surfaces so a reader who lands anywhere in `docs/prd/` can find them.

**What landed:**

1. `docs/prd/README.md` gains three traceability rows in the top table (one per phase file, matching the house-style column set: File / Type / Status / One-liner). Rows placed immediately after the plugin-program rows (`03..07`) so the index reads chronologically.
2. `docs/prd/README.md` gains a new subsection **"Global traceability — observer-mode program (Phases 14-16)"** modelled on the existing plugin-program traceability block. Rows map each briefing requirement (from the owner's own words captured in the GSL-347 epic description) to a destination phase and its acceptance-ID. Compact by design — the observer-mode source-of-truth doc is the epic description itself (not a strategy report the size of the plugin-migration one), so the traceability block is compact rather than exhaustive.
3. `docs/prd/PRD-gosleep-evolution.md` gains a new section **"Phases 8-16 — per-phase PRD files (index only)"** with a bullet per phase file (8 through 16). This closes a gap the README convention promised but earlier plugin-program PRD work (GSL-338) did not fill: the monolith carried a per-phase pointer only for Phase 7. With this task, the monolith becomes discoverable to any reader who lands there — they can jump to phase 8, 9, …, 16 without re-reading the README first.

**Not translating legacy phases 1-6.** Per owner rule `prd-english-per-phase-files.md` (2026-08-07): "Legacy phases 1-6 stay in the monolith as a historical Russian archive and are not translated retroactively — but every new PRD artefact is English by construction." Confirmed nothing in the historical monolith body was mutated; only the new "Phases 8-16" section was appended, and the existing "Phase 7 — Interactive control plane (moved to a per-phase file)" pointer stanza was preserved untouched.

**Skeptic pass.** Confirmed the three README rows and the traceability sub-block do not double-count or hide any briefing requirement. Cross-checked every acceptance-ID cited in the sub-block against the three phase files (F14-S1..S6, F15-S1..S7, F16-S1..S8, R14..R16) — all resolve. No dangling references.

**What hurt.** Only judgement calls:

- The plugin-program worker (GSL-338) explicitly noted that they did not add monolith pointers for phases 8-13, treating the README as the single index. I read that choice, decided the mission brief's explicit ask ("monolith already carries short English pointers to per-phase files under Phases 7+ — add the same style pointer for the three new observer-mode phases") is stronger, and added the full 8-16 pointer block in one shot rather than only 14-16. Result: no gap left behind for a future reader.

**What is deliberately NOT here.**

- No implementation of the observer program.
- No `~/.claude/**` writes.
- No `Workflow` tool, no subagents/teammates, no `git stash / reset --hard / add -A` in a shared tree — hard rules from the mission brief held.

---

## Part 2 — Short technical reference

### Files touched (this task)

```
docs/prd/README.md                      (three top-table rows added; new "observer-mode program" traceability sub-block)
docs/prd/PRD-gosleep-evolution.md       (new "Phases 8-16 per-phase files (index only)" section)
```

### Jira

- Epic: **GSL-347** — `[Docs][Web] Observer-mode PRD (phases A-C)`.
- Sibling task: **GSL-348** — writes the three phase files themselves.
- This task: **GSL-349** — index + pointer, In Progress → Done at commit.

### Verification of the docs task

- `grep -n "08-phase14\|09-phase15\|10-phase16" docs/prd/README.md docs/prd/PRD-gosleep-evolution.md` — every new filename referenced by both surfaces.
- Legacy 1-6 archive untouched (no diff in the 1-6 phase sections of the monolith).
- English-only rule holds — new prose is English; the only Russian in the touched files is pre-existing content in the monolith / owner-memory titles cited by name.

---

*End of dev history for GSL-349.*
