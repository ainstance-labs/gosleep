# GSL-43 — Deep-dive findings pack (autosk, warren/overstory, headless, loops, lab/UI)

**Epic:** GSL-41 — Orchestration deep-research → reports + PRD
**Branch:** GSL-41-orchestration-research
**Phase:** GSL-41 cycle 1 — research

---

## Part 1 — Story

### What was done
Landed the raw research findings pack that every downstream report and the PRD are built from —
five markdown deep-dives written by the research workers during the GSL-41 fan-out. They cover
the AutoSK orchestrator, the Warren/Overstory (jayminwest / os-eco) projects, the headless
`claude -p` + subscription + orchestrator landscape, community loop engineering, and the
"Laboratory" auto-doc / autonomy / UI / mobile theme. These are the source-of-truth notes; the
four HTML reports (GSL-44..47) and the PRD (GSL-48) cite them verbatim.

### Problems solved
Nothing to solve at commit time — this task is a straight capture of the workers' finished
research markdown into git. The scratch folder + `.research-cache/` gitignore were already
scaffolded under GSL-42, so the files dropped in cleanly.

### Problems remaining
None. The findings are frozen as the citation base; any correction happens in a follow-up task,
not by editing history.

### Pitfalls & workarounds
- These are working research notes, not polished docs — they intentionally keep worker voice and
  inline source pointers so the reports/PRD can trace claims. Don't "tidy" them; the PRD's
  seam-guard matrix points back at exact sections here.
- The heavy third-party repo clones the workers read live under `.research-cache/` are gitignored
  (set up in GSL-42) — only the distilled markdown is committed.

### What didn't make it
No synthesis or dedup across the five files — that is deliberately the job of the reports
(GSL-44..47) and the PRD (GSL-48), not this raw pack.

---

## Part 2 — Technical reference

**Files committed (all under `docs/research/2026-07-07-orchestration/`):**
- `01-autosk.md` (~31 KB) — AutoSK orchestrator deep dive
- `02-warren-overstory.md` (~37 KB) — Warren & Overstory (jayminwest / os-eco)
- `03-headless-subscription-landscape.md` (~37 KB) — headless `claude -p`, subscription compat, orchestrator landscape
- `04-loop-engineering.md` (~42 KB) — community state of the art for autonomous agent loops (2025–2026)
- `05-lab-ui-mobile-autonomy.md` (~48 KB) — Laboratory auto-doc + admin UI, autonomy & question buffer, orchestration UI, mobile
- `docs/dev_history/GSL-43-phase-gsl41-cycle1-research-findings-pack.md` — this file
- `docs/dev_history/README.md` — index updated with the GSL-43 entry

(`README.md` for the research folder was already committed under GSL-42.)

**Verified by running:** `git status` / `git diff --cached --stat` to confirm only the five
research files (+ this dev-history + index) are staged; per the writers' handoff the five markdown
files are self-contained (no external includes, inline source pointers). No gates apply to raw
research markdown.

**Links:** Jira [GSL-43](https://ainstance-labs.atlassian.net/browse/GSL-43) ·
GitHub [#50](https://github.com/ainstance-labs/gosleep/issues/50) · Epic
[GSL-41](https://ainstance-labs.atlassian.net/browse/GSL-41) / [#48](https://github.com/ainstance-labs/gosleep/issues/48)
