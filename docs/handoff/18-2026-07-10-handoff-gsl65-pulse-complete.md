# Handoff — gosleep — 2026-07-10 (GSL-65 complete: the "owner sleeps" core is ready)

> For a FRESH orchestrator. Ground truth = ORCHESTRATION-STATE.md (FIRST) + this file. Process rules verbatim — handoff 17 · section 4 (still current). Supersedes 17 on the resume point.

# ── Part 1 · Plain words ──

## 1. Where we are now
**Epic GSL-65 "Self-pulse + night mode" (PRD Phase 2) MERGED**: PR #82 → `main @ 135ce1f`, issues #75..#81 closed, Jira Done, remote branch deleted. Together with the watchdog (GSL-49) **the "owner sleeps" core is ready**: the orchestrator writes a pulse and wakes itself up on the right cadence, at night queues questions, survives limits, stops on loops, and an external watchdog restarts it on death.

## 2. What Phase 2 added (per component)
- **Pulse cadence** by cache windows: ~270s active monitoring / 540s+ stable wait / 1200–1800s deep; the zone [300,540) is forbidden; the armed-wake-up law: three legitimate turn exits — armed / quiesced+0 / rolling (without a wake-up).
- **Night mode/activeHours**: at night questions → QUESTIONS-PENDING, escalations into the buffer (critical always wakes), one summary in the morning; the heartbeat carries `mode`.
- **Quota auto-wait**: detect the limit by 4 signals → quiesced+ETA; one wake-up until ETA+120s; a safety net — watchdog v0.5.1 alarm (the quiesced shield expires 900s after ETA); auto-resume.
- **Circuit-breaker** on top of the loop-guard: 4 loop signals → OPEN (spawn stop + escalation), HALF_OPEN a single probe after 30 min, a second OPEN — only a manual reset from STATE.
- **HEARTBEAT_OK fast-path**: a cheap pulse ≤3-4 tool calls.
- The review caught 2 MAJOR logic holes (quota chain, rolling exit) — fixed before merge (69a12b9); smoke 75/75.

## 3. Three epics merged today
GSL-49 watchdog (PR #66 → 878f438) · GSL-58 autosk anatomy (PR #74 → a217393) · GSL-65 pulse/night (PR #82 → 135ce1f).

# ── Part 2 · Formal ──

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (11/21/31/41); GH ainstance-labs/gosleep, **main @ 135ce1f**, 0 open PRs; next Jira=GSL-72, GH=#83; owner accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67.

## GSL-65 SHAs
270e519 (66 ledger) / f35a2b2 (67) / b510de8 (68) / d1fbb42 (69) / 79f76bb (70) / 7e9b37c (71) / 69a12b9 (fix M1/M2) / merge 135ce1f. Paths: SKILL.md new sections; tools/watchdog v0.5.1 (smoke 75); dev_history GSL-66..71.

## ⭐ Immediate next steps
1. **Known tail:** the working tree is still on local branch `GSL-65-self-pulse-night` (a checkout of main blocked on the uncommitted ledger). Next epic setup: `git fetch origin && git checkout main`... if the ledger blocks — do NOT use `git checkout -m main`; path: commit the ledger DIRECTLY on the new epic branch created from origin/main (`git checkout -b <EPIC>-question-buffer origin/main` will carry over uncommitted), then `git branch -d GSL-65-self-pulse-night`.
2. **Setup Phase 3 PRD "Question buffer + decision manifest"** (Opus, mechanics): PRD constraints C1-C8 + Phase 3 section → Jira epic + tasks (+ task-1 [Process] ledger: STATE + handoffs 17, 18) + GH mirror + branch from origin/main + housekeeping commit + push. Pipeline briefs — per the GSL-65 template (STATE log).
3. impl Fable → mechanic PR → reviewer Fable → merge finalizer Opus → handoff 19 → report → Phase 4 Laboratory.

## Backlog
pi/packages/orchestrator analysis (prior art!); watchdog F1-S1 live-check (owner); e2e night run with rate_limit injection; gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; local branches GSL-7/19 (+GSL-65 after leaving it); owner's prompts file. Telemetry: ~65 cycles, ≈4.7M+ (the full block in STATE; cycles 32/35 gap).
