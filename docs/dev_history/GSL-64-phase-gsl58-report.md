# GSL-64 — Отчёт AutoSK Anatomy — EN+RU dashboard

**Epic:** GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)
**Branch:** GSL-58-autosk-anatomy
**Phase:** GSL-58 — content research, task 5 of 5 (synthesis)

---

## Part 1 — Story

### What was done
Synthesised the four research artifacts (pi-agent, Go TUI, unmerged PRs, site-delta) plus the
07-07 baseline into a single self-contained HTML dashboard — **"AutoSK Anatomy — bone by bone"** —
shipped in both English (`index.html`) and Russian (`RU/index.html`). It's the reader-facing
deliverable of the epic: one place the owner can open and see the whole anatomy without walking the
raw markdown. The RU edition is a full translation, not a stub (175 KB vs the EN 135 KB). Lands
under `docs/reports/autosk-anatomy/`.

### Problems solved
Kept both editions self-contained (inline CSS/JS, no external asset fetches) so the report opens
straight from disk with no build step and no network — the report is the artifact, not a site that
needs serving.

### Problems remaining
None for this task. Any future research round would append a new dated report rather than mutate
this one.

### Pitfalls & workarounds
- Two parallel language editions mean any content correction has to be applied twice (EN + RU) or
  they drift — a known maintenance cost accepted for owner readability.
- Large single-file HTML (135 KB / 175 KB): intentional — self-containment was chosen over
  splitting into linked assets, so the files are big but portable.

### What didn't make it
Nothing dropped. No PDF export or hosted version was produced — the self-contained HTML is the
agreed deliverable for this epic.

---

## Part 2 — Technical reference

**Files committed:**
- `docs/reports/autosk-anatomy/index.html` (1017 lines, ~135 KB) — EN dashboard, "bone by bone"
- `docs/reports/autosk-anatomy/RU/index.html` (~175 KB) — RU dashboard, "по косточкам"
- `docs/dev_history/GSL-64-phase-gsl58-report.md` — this file
- `docs/dev_history/README.md` — index updated

**Verified by running:** structural validation against the researcher's report — both files present
and non-empty; `<title>` confirmed (EN "AutoSK Anatomy — bone by bone (GSL-58)", RU "Анатомия
AutoSK — по косточкам (GSL-58)"); self-contained (no external `<link>`/`<script src>` fetches).

**Links:** Jira [GSL-64](https://ainstance-labs.atlassian.net/browse/GSL-64) ·
GitHub [#73](https://github.com/ainstance-labs/gosleep/issues/73) · Epic
[GSL-58](https://ainstance-labs.atlassian.net/browse/GSL-58) / [#67](https://github.com/ainstance-labs/gosleep/issues/67)
