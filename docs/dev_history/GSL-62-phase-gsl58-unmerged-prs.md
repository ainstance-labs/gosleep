# GSL-62 — Разбор unmerged PRs autosk — 6 осиротевших PR одного контрибьютора

**Epic:** GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)
**Branch:** GSL-58-autosk-anatomy
**Phase:** GSL-58 — content research, task 3 of 5

---

## Part 1 — Story

### What was done
Read all 6 open PRs on `wierdbytes/autosk` end to end (live `gh` + the pinned clone for v2
cross-checks) and found the single loudest project-vector fact: **every open PR is an orphan of the
v1→v2 clean break.** All six came from one outside contributor (`Conte777`) in a single burst on
2026-06-01/02; three weeks later the author shipped the v2 rewrite (doltlite→plain files, Go
daemon→Bun `autoskd`, JSON workflows→TS extensions) that deleted every path those PRs touch. The
author never reviewed, merged, or closed any of them — bus-factor-1 in action. Each PR is
catalogued with what it did, its quality, its v2 fate (absorbed / dead / bug-class-still-live), and
what gosleep should copy (e.g. PR #1's terminal-only task-dep release semantics). Lands as
`04-unmerged-prs.md` (72 lines).

### Problems solved
GitHub itself had given up computing mergeability (#6 `CONFLICTING/DIRTY`, #1–#5 `UNKNOWN`), so the
"does it still apply" verdict had to be reconstructed by hand — checking each PR's target paths
against the v0.2.4 clone to confirm they no longer exist at HEAD.

### Problems remaining
None for this task — research artifact only.

### Pitfalls & workarounds
- Live-data snapshot: PR states were read 2026-07-10; the repo is frozen (see GSL-63) so the
  snapshot is expected to stay valid, but it is a point-in-time read, not a live feed.
- Clone cross-checks use the same gitignored `.research-cache/autosk` @ `fd4c22e`.

### What didn't make it
Nothing dropped. No attempt was made to rebase/salvage any PR — out of scope; this is analysis of
someone else's repo, not a contribution to it.

---

## Part 2 — Technical reference

**File committed:**
- `docs/research/2026-07-10-autosk-anatomy/04-unmerged-prs.md` (72 lines, ~12 KB) — PR-by-PR read
- `docs/dev_history/GSL-62-phase-gsl58-unmerged-prs.md` — this file
- `docs/dev_history/README.md` — index updated

**Deliberately NOT committed:** `.research-cache/` clones (gitignored, re-clone at `fd4c22e`).

**Verified by running:** structural validation against the researcher's report — `wc -l` (72
lines); 6 `### #N` PR sections present (grep count = 6), each with What / Quality / v2 fate /
gosleep takeaway; headline "all 6 open PRs are orphans of the v1→v2 clean break" stated up front.

**Links:** Jira [GSL-62](https://ainstance-labs.atlassian.net/browse/GSL-62) ·
GitHub [#71](https://github.com/ainstance-labs/gosleep/issues/71) · Epic
[GSL-58](https://ainstance-labs.atlassian.net/browse/GSL-58) / [#67](https://github.com/ainstance-labs/gosleep/issues/67)
