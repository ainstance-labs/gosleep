# GSL-51 — Heartbeat protocol: orchestrator liveness on disk

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, requirement R1.1 (heartbeat producer)

---

## Part 1 — Story

### What was done
The orchestrator now has a machine-readable "I'm alive" signal on disk. Until now its pulse only
lived in chat and in its own head — if it died at 3am, nothing outside it could tell. This task
added the heartbeat protocol to the `orchestrating-delivery-agents` skill: the first act of every
pulse is to atomically append one JSON line (`ts`, `cycle`, `context_pct`, `open_workers`, optional
`status`) to `docs/handoff/.orchestrator-heartbeat`. An external watchdog (the next tasks in this
phase) can then judge liveness purely from file mtime + the last line — dead orchestrator = the
mtime stops growing, observably. The section also spells out the watchdog's side of the contract
(staleness → nudge → kill+re-wake, context ceiling → handoff, startup grace, never-judge-from-a-
single-store) so the orchestrator knows the rules it lives under, plus `rolling`/`quiesced` end-of-
session markers so a planned exit is never mistaken for a death.

### Problems solved
- **Where should the write mechanics live?** Not in a repo-local helper script: the skill installs
  globally and runs in ANY project, so the exact atomic-append snippet is embedded in SKILL.md
  itself (PRD task 1 is `[Skill]`-scoped; the consumer script belongs to the watchdog task).
- **Unbounded growth vs append-only:** solved by a self-truncating atomic rewrite — each write keeps
  the last 199 lines + the new one (cap 200), via same-directory hidden temp + rename, matching the
  skill's existing STATE-file convention. Watchdog contract (`tail -1` + mtime) is unaffected.
- **Planned exit vs death:** without a marker, a watchdog would restart an orchestrator that had
  deliberately finished. Optional `status:"rolling"` (successor expected) and `"quiesced"` +
  `open_workers:0` (chain done, do NOT restart) close that hole.

### Problems remaining
The producer side is done; nothing consumes the file yet. The launchd watchdog (GSL-52), restart
budget (GSL-53) and debounce lessons (GSL-54) are the consumers. Until they land, the heartbeat is
written but nobody acts on staleness. Startup-grace and single-store-cross-check are documented as
the watchdog's obligations — they must be implemented in GSL-52/54, not just described.

### Pitfalls & workarounds
- Gastown #567 baked in: heartbeat checks killed freshly-started sessions before they wrote their
  first heartbeat. The skill therefore tells a cold-started orchestrator to write its first
  heartbeat right after the on-disk orientation reads, inside the ~90–120s grace window.
- The heartbeat file is runtime state, not history — it changes every few minutes and would churn
  git forever. Gitignored as `docs/handoff/.orchestrator-heartbeat*` (the pattern also covers the
  `.tmp`), and the skill instructs every project to do the same.
- `context_pct` must be the honest estimate: a fabricated number silently defeats the roll-at-~70%
  rule (the watchdog compares it to the ceiling). Called out in Common mistakes.

### What didn't make it
No helper script under `tools/watchdog/` — deliberate (see Problems solved; the PRD assigns tooling
to the watchdog tasks). No pulse-cadence policy — that is explicitly Phase 2 (R2.1); this section
fixes only WHAT gets written and WHEN.

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — new section «Heartbeat protocol — orchestrator
  liveness on disk» (path, JSONL format, write-first rule, atomic self-truncating snippet, watchdog
  contract incl. startup grace + single-store rule, pulse-rule relation); cold-start step 6 (first
  heartbeat after orientation); roll boundary (final `rolling`/`quiesced` line); 2 Quick-reference
  rows; 1 Common-mistakes bullet; 1 Red-flag entry.
- `.gitignore` — `docs/handoff/.orchestrator-heartbeat*` (runtime signal + atomic temp).
- `docs/dev_history/GSL-51-phase-gsl49-heartbeat.md` + `README.md` index — this entry.

**Protocol (PRD R1.1):**
- Path: `docs/handoff/.orchestrator-heartbeat` (project-scoped, beside STATE; gitignored).
- Line: `{"ts":"<UTC ISO-8601>","cycle":N,"context_pct":N,"open_workers":N,"status":"ok"}`;
  required `ts/cycle/context_pct/open_workers`; optional `status` ∈ `ok|rolling|quiesced`, `note`.
- Write: FIRST act of every pulse; atomic `{tail -n 199; printf line} > .tmp && mv` (cap 200 lines).
- Consumer reads `stat` mtime + `tail -1`; staleness/ceiling/quiesced semantics per SKILL.md.

**Verified by running:**
- `./install.sh` → 5 skills installed; `diff` local vs `~/.claude/skills/.../SKILL.md` → identical;
  grep finds the new section in the global copy.
- Smoke test of the exact snippet in `.artifacts/hb-smoke/` (removed after): file created; `tail -1`
  parses as JSON (`python3 -m json.tool` + field assert); mtime advances across writes; 210 writes →
  exactly 200 lines kept, newest last; zero `.tmp` residue after rename.
- `git check-ignore -v` matches both the heartbeat file and its `.tmp`.

**PRD acceptance (R1.1):** mtime updates every pulse — mechanism verified by smoke; `tail -1`
watchdog-parseable — verified; death ⇒ mtime stops — by construction (write-first, no other writer).
C7 (liveness from durable state only) and C8 (atomic temp+rename) satisfied.

**Links:** Jira [GSL-51](https://ainstance-labs.atlassian.net/browse/GSL-51) ·
GitHub [#59](https://github.com/ainstance-labs/gosleep/issues/59) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)

---

## Review fixes (2026-07-10, epic review C1 — `docs/reviews/REVIEW-gsl49.md`)

The heartbeat line now **requires a `pane` field** — the orchestrator's own tmux pane id,
literally `$TMUX_PANE`. The review found the watchdog resolved its nudge/kill target
*positionally* (first pane of the window / `session:0.0`); in the epic's main scenario —
orchestrator dead, workers alive in the same window — that target is a live WORKER. Self-declared
identity in the heartbeat is the only trustworthy source, so the protocol carries it: format line,
required-fields list and the atomic snippet in SKILL.md updated (`"pane":"'"${TMUX_PANE:-}"'"`),
plus the contract note that a live session without a verifiable `pane` is never guessed at — the
watchdog refuses (`kill_refused reason=identity_unverified`) and escalates. Re-verified:
`./install.sh` → global copy identical (diff). Consumer side: see GSL-52 review-fixes block.
