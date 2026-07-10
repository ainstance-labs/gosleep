# GSL-60 — pi-agent internals — помодульный разбор (earendil-works/pi, code-only)

**Epic:** GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)
**Branch:** GSL-58-autosk-anatomy
**Phase:** GSL-58 — content research, task 1 of 5

---

## Part 1 — Story

### What was done
Dissected autosk's *second* agent runtime — the "pi stack" — module by module, static-read only.
The finding: pi is three cooperating pieces across a process boundary — `@autosk/pi-agent` (the
daemon-side driver that spawns `pi --mode rpc` per workflow step), `pi-transit-extension.ts` (the
ack-only `autosk_transit` tool loaded into the spawned pi), and `@autosk/pi-tools` (the
transport-aware `autosk_task`/`autosk_comment` tools). autosk treats pi exactly like `claude`: an
operator-installed, operator-authenticated binary on PATH. The write-up lands as
`02-pi-agent.md` (142 lines) alongside the earlier claude-agent twin from the 07-07 baseline.

### Problems solved
The researcher had to read two clones side by side — autosk `.research-cache/autosk` @ `fd4c22e`
(v0.2.4) for the daemon side, and `.research-cache/pi` (earendil-works/pi) for the spawned side —
to reconstruct what happens on each side of the process boundary; nothing was executed, so every
claim is anchored to a file:line citation.

### Problems remaining
None for this task. This is a documentation/research artifact — no code changed in gosleep.

### Pitfalls & workarounds
- The clone (`.research-cache/`) is **deliberately gitignored** and NOT committed — only the
  distilled markdown lands in git. A future reader who wants to re-verify must re-clone at the
  pinned SHA `fd4c22e`.
- pi is an external moving target (npm `@earendil-works/pi-coding-agent`, latest 0.80.6 at time of
  read) — the analysis is pinned to what autosk v0.2.4 actually invokes, not to pi's current HEAD.

### What didn't make it
Nothing dropped. Runtime behaviour (actually spawning pi) was explicitly out of scope — code-only
mandate for the whole epic.

---

## Part 2 — Technical reference

**File committed:**
- `docs/research/2026-07-10-autosk-anatomy/02-pi-agent.md` (142 lines, ~28 KB) — pi stack dissection
- `docs/dev_history/GSL-60-phase-gsl58-pi-agent.md` — this file
- `docs/dev_history/README.md` — index updated

**Deliberately NOT committed:** `.research-cache/` clones (gitignored, re-clone at `fd4c22e`).

**Verified by running:** structural validation against the researcher's report — `wc -l` (142
lines), section headings present (§1 daemon-side driver, spawn/argv, transit extension, pi-tools),
every claim carries a `src/index.ts:NNN` file:line citation.

**Links:** Jira [GSL-60](https://ainstance-labs.atlassian.net/browse/GSL-60) ·
GitHub [#69](https://github.com/ainstance-labs/gosleep/issues/69) · Epic
[GSL-58](https://ainstance-labs.atlassian.net/browse/GSL-58) / [#67](https://github.com/ainstance-labs/gosleep/issues/67)
