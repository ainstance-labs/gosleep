# GSL-48 — PRD: GoSleep evolution plan (orchestration v-next)

**Epic:** GSL-41 — Orchestration deep-research → reports + PRD
**Branch:** GSL-41-orchestration-research
**Phase:** GSL-41 cycle 1 — PRD

---

## Part 1 — Story

### What was done
Landed the capstone of the GSL-41 epic: the consolidated PRD for evolving GoSleep into an
"orchestrator the owner can sleep through". One markdown file holds all six phases —
(1) watchdog over the orchestrator, (2) self-pulse + night mode, (3) question buffer + decision
manifest + morning digest, (4) Laboratory auto-documentation, (5) orchestration UI, (6) mobile —
plus a PRD index (`README.md`). The PRD turns the four reports and the raw findings pack into a
phased, traceable plan.

### Problems solved
Nothing mechanical at commit time — the writer delivered a finished PRD; this task stages it with
its index and commits. The traceability design (below) was solved in the authoring, not here.

### Problems remaining
None for this task; the PRD is Draft (2026-07-08) and is the input to the next delivery cycle, not
final locked scope.

### Pitfalls & workarounds
- **Single-file consolidation:** all six phases live in one PRD file, so the authoritative
  end-to-end **traceability matrix** (finding → phase → req-ID → acceptance criterion) and the
  deferrals list live *inside* the file (section "Сквозная матрица трассируемости (seam-guard)")
  rather than across multiple PRD files. The `README.md` explains this so a reader doesn't hunt
  for per-file seams that don't exist.
- The PRD is written in Russian (owner's working language), consistent with the RU report track.
- **Explicit non-goal:** the PRD states that `skill/orchestrating-delivery-agents/SKILL.md` (and
  handoff/delivery-workflow/using-jira) do **not** change under this initiative — a guardrail a
  future implementer must respect.

### What didn't make it
No Jira epics/tasks were created for the six PRD phases in this task — that is the next cycle's
planning work. This task only lands the document.

---

## Part 2 — Technical reference

**Files committed (all under `docs/prd/`):**
- `PRD-gosleep-evolution.md` (~81 KB) — consolidated 6-phase initiative PRD
  ("Эволюция GoSleep: оркестратор, при котором владелец спит"); sections: Часть 1 (plain-words),
  constraints, phase map, global goals/non-goals/success, Фазы 1–6, seam-guard traceability
  matrix, risk register, decision log, sources appendix.
- `README.md` (~2 KB) — PRD index (type, status, per-phase table, traceability note)
- `docs/dev_history/GSL-48-phase-gsl41-cycle1-prd-gosleep-evolution.md` — this file
- `docs/dev_history/README.md` — index updated with the GSL-48 entry

**Source:** synthesizes all four reports (GSL-44..47) and the raw findings pack
`docs/research/2026-07-07-orchestration/{01..05}-*.md`.

**Verified by running:** confirmed the six phase sections + seam-guard matrix are present via
heading grep; `git diff --cached --stat` to confirm only `docs/prd/` (+ dev-history + index) is
staged. Markdown doc — no build gates apply.

**Links:** Jira [GSL-48](https://ainstance-labs.atlassian.net/browse/GSL-48) ·
GitHub [#55](https://github.com/ainstance-labs/gosleep/issues/55) · Epic
[GSL-41](https://ainstance-labs.atlassian.net/browse/GSL-41) / [#48](https://github.com/ainstance-labs/gosleep/issues/48)
