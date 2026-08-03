# Handoff — gosleep — 2026-08-03 (shift 74 closed: four epics, skills system, web interface architecture)

> For a NEW orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoffs 53 and 55. Shift ran 28 July — 3 August with a five-day subscription outage.

# ── Part 1 · Plain words ──

## 1. Where we are

The shift closed four epics of the audit plan and staged two large builds. Landed and merged into main:
lab hygiene (GSL-175), configurable token ceiling (GSL-179), external tick engine (GSL-176),
observing supervisor (GSL-178). The check suite grew from 452 to 545, we now have a single gate
`gate.sh`, an `apply-due` tool, a live rebuild debounce, and a watchdog observe run.

In the second half of the shift the owner steered the work toward the product: he rejected the current
web (observing Preact pages, not a single button) and demanded a real interactive control interface.
A panel of six agents ran the research, the target architecture was designed, tasks were filed.
Implementation did not start — that is the next shift's work.

## 2. What the owner decided (matters most)

- **Production skills (`~/.claude/skills/`) are edited by the OWNER ONLY.** Agents are strictly
  forbidden, under any wording of the command. Development happens in the repository's `skill/`,
  publish is a manual action by the owner via a button in the admin panel. Four layers of protection,
  of which the guard in `install.sh` (`exit 1` before the first rsync) is already working today.
- **We build the web on the Warren model:** a core server + different clients (web, CLI, mobile
  later). Client: React 19 + Vite 6 + shadcn/ui + Tailwind + TanStack Query. Preact rejected.
- **SQLite — source of truth**, not a projection; Drizzle ORM + drizzle-kit, migrations in git.
- **Core `gosleep-core`**: Bun 1.2 + Hono 4 + zod. Not Nest, not Fastify, not raw Bun.serve.
- **Typography:** Geist Sans + Geist Mono, embedded into reports, soft palette above AA.
- **Token limits configurable** + mandatory unlimited mode.
- **Epic GSL-180 (agent permissions) postponed** to the backlog as not currently relevant.
- **Worker observability:** the owner complained that agents fall silent for hours. Introduced
  the rule — a short PROGRESS every 5-7 minutes and reading mail at the start of every turn. Works.

## 3. What's next

Two builds, tasks filed and assigned to the owner:
- **GSL-174** — how skills are edited and published: GSL-251…257 (catch-up copy, registry,
  publish tool, tests and guard, "Skills" page, question queue contract, acceptance).
- **GSL-250** — interactive web interface (control plane): GSL-258…271 (monorepo, generator
  freeze, core skeleton, schema and migrations, ledger import, indexer and event stream,
  authentication, client, first button, remaining actions, polish, retirement of the old UI).
  Honest schedule: 17-21 days to the first write button, 30-38 days for the full first version.

## 4. Shift problems and lessons

- The orchestrator twice pushed decisions on the owner that he had not ordered: edits to production
  skills and an architecture with files instead of a database. Both caught and rolled back. Lesson
  stored in memory: "roll it back" = return the exact text, with no variants and no middle ground.
- The orchestrator asked the owner questions instead of researching them ("how will the core tell
  you from an agent") — got fair criticism. Rule: bring options with a recommendation, not questions.
- Worker model: the spawn-time parameter was ignored; only the config
  `CLAUDE_CODE_SUBAGENT_MODEL` in the owner's settings helped. Check the model ONLY from the
  transcript — self-report lied four times.
- Time estimates were understated by 2-3× until the red team checked them.

## 5. Comments

The owner is active and replies quickly; he works in waves of 2-4 hours. It matters to him to see
how the agents are progressing, not only the result. Reports to the owner — in Russian, as a
dashboard, no jargon.

# ── Part 2 · Formal ──

## Hard rules (full set — Standing rules in ORCHESTRATION-STATE.md)
Production skills are edited by the owner only (2026-08-03) · standard gate `bash tools/lab/gate.sh`
(GSL-203) · bundle grade != fresh must not be silently committed (GSL-194) · token limits
configurable + unlimited (d-007) · pulse: heartbeat → ScheduleWakeup SECOND → probes → TEXT to
owner last · workers: PROGRESS every 5-7 min + mail read at the start of each turn · NO Workflow
(ask-first) · REGULAR merge · closes before each number · no force-push · sovereign untouched ·
mobile and push on pause · install.sh under guard.

## Connections
Jira GSL, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/41 · GitHub
`ainstance-labs/gosleep` · owner Roman L, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`
· main @ f4ef882+ · global skills (5 in total) + tmux-agents-orchestration.

## Gates
`bash tools/lab/gate.sh` — smoke 545/545 FAIL=0, hooks-verify 19, tsc 0, chronicler with polling,
grade=fresh. Watchdog: `bash tools/watchdog/smoke.sh` 168/0. Breaker line in STATE:
`bash tools/lab/breaker-check.sh`. Cycle boundary: `docs/handoff/GSL-223-orchestrator-cycle-boundary-jira-dump.md`.

## Delivered this shift (all in main)
PR #252 (GSL-175), #253 (GSL-179), #254 (GSL-176), #255 (GSL-178), #256 + #257 + #258 (skills
system plan and dashboard), #259 (web interface research). Ledger chain: a114c8a → 746e98c →
e72d818 → 725fce7 → 761eb3d → 3da5a9b → 87fb3e4 → b1f0280 → f4ef882.

## Key documents for the next shift
- `docs/plans/skills-governance-plan.md` — approved skills-system plan (7 stages).
- `docs/reports/skills-governance-2026-08-03/index.html` — plan dashboard (RU+EN).
- `docs/reports/web-harness-research-2026-08-03/target-architecture.md` — **target architecture,
  revision 2** (12 sections + 3 appendices). Main document for GSL-250.
- `.../design-system.md` — Geist, palette, tokens, report migration plan.
- `.../redteam-verdict.md` — 3 critical / 5 major / 6 minor, "verified and holds" section.
- `.../findings/` — three expert files (AutoSK/Warren/Overstory, 25+ market tools, our
  constraints).
- `.../index.html` — research dashboard, **contains an outdated recommendation for variant A**;
  update it against the target architecture and the new design system (task not filed yet — file it).

## Shift decisions
d-2026-07-28-001…016, d-2026-08-03-001…006 in `docs/lab/decisions/log.jsonl`. Question queue:
open=0 — no open questions to the owner in the system.

## TELEMETRY
cycles_completed≈180, tokens_out≈19.5M+ (details in the TELEMETRY block of the state file). Shift 74:
17 workers, of which 4 were early kill/redo. Models: orchestrator Fable 5, workers Opus 4.7
(via `CLAUDE_CODE_SUBAGENT_MODEL` in the owner's settings).

## RESUME POINT — new orchestrator
1. Cold start: 5 global skills + tmux-agents-orchestration → ORCHESTRATION-STATE.md
   (At a glance, LIVE-STATUS, Standing rules) → this handoff.
2. Sanity: `tmux list-panes` · `git log origin/main -1` (f4ef882 or newer) · `gh pr list --state open`
   (empty) · `tools/lab/lab-emit.sh list --count` (open=0) · `bash tools/lab/breaker-check.sh` ·
   `bash tools/lab/lab-emit.sh apply-due`.
3. First heartbeat: `bash tools/lab/heartbeat.sh --cycle 181 --context-pct N --open-workers 0 --status ok`.
4. Ask the owner where to start: epic GSL-174 (skills system, cheaper and faster) or
   GSL-250 (web interface, large build). The first task in either is GSL-251/GSL-258.
5. Build worker briefs from the shift template: goal, sources, gate `gate.sh`, one dev_history per
   task, PR without merge, observability rule (PROGRESS every 5-7 min, mail at the start of the turn),
   hard prohibitions (production skills, install.sh, Workflow, tree-wide git).
6. Open questions to the owner not filed in the queue yet: Geist or Inter; date of the control night;
   whether to fix minor/nit items from the two design reviews; whether to update the research dashboard.

## Gotchas
- Worker model — only from the transcript (`grep '"model"'` in `~/.claude/projects/…/*.jsonl`,
  find the file by the brief phrase). Self-report lies.
- ScheduleWakeup response is a trap: it does not permit you to end the turn. Text to the owner is
  the last act.
- An empty idle-notification from a live worker = mandatory `tmux capture-pane`; after a kill it is
  noise.
- `gh pr merge` trips over uncommitted files: the merge on GitHub goes through, locally you need
  `git checkout main && git pull` (without reset/stash — they are forbidden).
- Tests with `lab-emit` — only under `GOSLEEP_LAB_DIR`, otherwise a write leaks into the live queue.
- Worker handoffs are not committed by workers — the ledger picks them up.

## Owner requirements for the live interface (d-2026-08-03-007, mandatory for GSL-250)
1. A window of agent questions in real time: a new question is visible immediately, with its status
   (blocking / non-blocking) and with an indication that the answer was given by the manifest and
   which one exactly.
2. How many agents are running right now, what each is doing, what its context is.
3. Near-second updates — via an event stream, not by timer polling.

Verified by the orchestrator: feasible on the chosen stack, NO dependency on the one-shot mode
(`claude -p`). Three sources, all working in the ordinary interactive mode on the subscription:
(a) 13 hook types in `.claude/settings.json` write events to our JSONL at the moment they fire;
(b) the session transcript `~/.claude/projects/<project>/<session>.jsonl` is written by the platform
in real time (verified: mtime matches the current minute on a live session) — gives the "what the
agent is doing right now" level; (c) `claude agents --json` — live session list (introduced in
GSL-212). Transport: SSE via `streamSSE` in Hono (Warren uses line-by-line JSON, the same thing
without the standard wrapper). Additionally, take from AutoSK the collapsing of frequent updates,
otherwise ten agents will flood the interface.

## PRD
`docs/prd/PRD-gosleep-evolution.md` — phases 1-6 (Phase 5 "Orchestration UI" described the static
HTML v1, Phase 6 "Mobile" is frozen by the owner). **A new PRD phase is needed** for the
interactive control plane (epic GSL-250) — file it as the first task of the new shift, building on
`docs/reports/web-harness-research-2026-08-03/target-architecture.md`.

## Blocked on the human
1. Where to start: GSL-174 or GSL-250.
2. Geist or Inter; ceiling on report weight.
3. Date of the control night (everything for preflight has been ready since epic GSL-176).
4. Arming the watchdog after three days of observation (`docs/runbooks/watchdog.md`).
