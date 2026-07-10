# GSL-63 — Re-fetch autosk.app — zero delta, проект FROZEN

**Epic:** GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)
**Branch:** GSL-58-autosk-anatomy
**Phase:** GSL-58 — content research, task 4 of 5

---

## Part 1 — Story

### What was done
Closed the one open loop from the 07-07 baseline: the live site had never been re-fetched and was
only *assumed* to match the repo's `website/` source. Re-fetched https://autosk.app/ and cross-read
the GitHub API. Result is stronger than expected — **zero delta, the project is frozen.** No commits
since the clone (`fd4c22e` still HEAD, `pushed_at` 2026-06-28 — 12 days of silence), latest release
still v0.2.4, adoption byte-identical to the baseline (27 stars, 5 forks, 8 open issues/PRs), and
the live hero/eyebrow/meta copy maps verbatim to `Hero.astro`/`Base.astro`. Conclusion: every
claimed-vs-implemented finding in the 01-autosk baseline remains valid against the live site.
Lands as `05-site-delta.md` (53 lines) with a full one-page site inventory.

### Problems solved
"Frozen" is a claim you have to prove, not assume — nailed it with three independent signals
(commit HEAD unchanged, release unchanged, adoption counters unchanged) plus a verbatim
copy-to-source map so the "no re-positioning" conclusion is evidence-backed, not eyeballed.

### Problems remaining
None for this task — research artifact only.

### Pitfalls & workarounds
- Point-in-time snapshot (WebFetch + GitHub API, 2026-07-10). "Frozen" is true as of this read; a
  future re-check would need to re-run the same three signals.
- Live-copy fragments are quoted against the pinned `website/src/` source in the clone, so the map
  survives even if the site later changes.

### What didn't make it
Nothing dropped. No deeper crawl was needed — the site is a single anchor-nav page with no
subpages, fully inventoried in §2.

---

## Part 2 — Technical reference

**File committed:**
- `docs/research/2026-07-10-autosk-anatomy/05-site-delta.md` (53 lines, ~6 KB) — re-fetch + delta
- `docs/dev_history/GSL-63-phase-gsl58-site-delta.md` — this file
- `docs/dev_history/README.md` — index updated

**Deliberately NOT committed:** `.research-cache/` clones (gitignored, re-clone at `fd4c22e`).

**Verified by running:** structural validation against the researcher's report — `wc -l` (53
lines); headline "zero delta — the project is frozen" present; three freeze signals (HEAD,
release, adoption) and the live-section → `website/src/components` source map table present.

**Links:** Jira [GSL-63](https://ainstance-labs.atlassian.net/browse/GSL-63) ·
GitHub [#72](https://github.com/ainstance-labs/gosleep/issues/72) · Epic
[GSL-58](https://ainstance-labs.atlassian.net/browse/GSL-58) / [#67](https://github.com/ainstance-labs/gosleep/issues/67)
