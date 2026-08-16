# Handoff — gosleep — 2026-08-15 (ROLL to shift 78: skills→plugins migration research mandate)

> For a FRESH orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 60. Predecessor (shift 77, Fable 5, pane %10) ROLLED at owner command. Owner ENGAGED (day).
> HARD GATE at roll: fleet EMPTY (open_workers=0), clean boundary. Successor takes over; predecessor stops.

## ORCHESTRATOR REPORT
Shift 77 delivered: independent web QA (runs 03-05) + the full live-fire E2E burn-in arc (runs 06-10, 5 fix
cycles, all merged). Web is QUALITY-READY @ main 60cc5ae — live-agent DEFER round-trip proven, every finding
found→fixed→re-verified on the real dev-agent path. Then a ~4-day owner-silent wait on PR #307. Owner returned
2026-08-15 and gave a NEW HEADLINE MANDATE (roll to a fresh orchestrator to carry it): research + strategy for
migrating our SKILLS system to a PLUGINS system, with proper versioning and provenance — both GLOBALLY
(~/.claude) and inside the gosleep project (our future harness). This handoff hands that off. Every shift-77
worker was Opus 4.7, transcript-verified. Fleet EMPTY.

# ── Part 1 · Plain words ──

## 1. Where we are
The web control plane is done and battle-tested (all merged to main @ 60cc5ae). Two things sit unfinished:
(a) PR #307 — the skills-management system slice — is open, built, but NOT trivially mergeable (29 commits
behind main, mergeability UNKNOWN, last verified 6 days ago); it's the owner's review surface. (b) The owner
has now set a bigger direction: he wants us to STOP thinking in "skills" and move to a PLUGINS system, because
our current skills — especially the GLOBAL ones under ~/.claude/skills — have NO versioning, no clear record of
who changed what, and that's painful. He wants a fresh orchestrator to RESEARCH how to do this properly and
build the foundation.

## 2. Owner decisions / feedback (matter most)
- ⭐ NEW MANDATE 2026-08-15: research + strategy for SKILLS → PLUGINS migration. See RESUME POINT for the full
  brief. This is the new headline; the plugin work leads, PR #307 becomes secondary context.
- PR #307 (skills-management) is the owner's review surface — NEVER merge without owner review. Owner asked
  "is it ready, just merge?" — answer given: no, it needs main merged in + gates re-run + fresh verification
  first, and it's a slice (no TouchID pieces, only GSL-186 of the content edits).
- Haiku BANNED all roles; minimum tier = Sonnet. Workers default Opus 4.7; Fable 5 point-wise.
- Do NOT watch/narrate own context (memory no-context-obsession-just-execute). Do NOT make silent default
  decisions; ask explicitly and wait (memory no-silent-default-decisions).
- Global skills authoritative (global→local only); NEVER auto-write ~/.claude/skills; install.sh under guard.
  This SAFETY rule is exactly what the plugin research must respect AND what it aims to improve (versioning).
- Workers VISIBLE tmux panes; close = kill-pane + TaskStop <name> + telemetry. Prod (data/, :7331, TouchID) paused.

## 3. What's next
1. ⭐ RESEARCH the skills→plugins migration (the RESUME POINT). Deliver a strategy document to the owner, not
   code first — he wants to understand the path before we build.
2. PR #307 — bring to mergeable+verified state when the owner wants it (merge main in, resolve conflicts,
   re-run gates, fresh verification); owner merges.
3. GSL-182-188 skill-lesson edits — owner wants to see diffs before any global publish. These may be reframed
   under the plugin model (an edit becomes a versioned plugin change).

## 4. Problems / lessons this shift (carry the quality lesson)
- The QUALITY MANDATE caught defects 3 LAYERS DEEP: unit tests + in-process proofs kept passing while a real
  LIVE agent kept finding what they missed (fleet-model boot-race twice; the permission-timeout fix itself had
  a missing Origin header only the real-agent path exposed). Lesson for the plugin work too: verify the real
  path, not just the model of it.
- Adversarially adjudicate your own workers — I stopped two premature "confirmed" claims and forced real proof.
- heartbeat.sh occasionally runs slow (>120s, backgrounds) — benign, check exit code, don't panic.

## 5. Comments & recent decisions
- Test fixtures live on: private repo ainstance-labs/gosleep-e2e-todo (permanent throwaway); Playwright
  standalone at tools/e2e (bun runtime; NOT in root workspaces). Test Jira epics closed as artifacts.
- Owner's OTHER project (tasty-lunch) runs dev-tlm* workers in panes %0/%298/%307 — NEVER touch them.
- The shared working tree sits on branch GSL-174-skills-management with ~38 dirty orchestrator live files
  (docs/lab/*, docs/handoff/*). That is normal live state, not work-in-progress to commit. Branch is also PR #307's head.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md + memory MEMORY.md)
Workers default Opus 4.7 (settings.local.json pin), Fable 5 point-wise; Haiku BANNED, min Sonnet · verify EVERY
worker model from transcript JSONL · NO Workflow tool for workers · REGULAR merge, closes-before-each-number ·
no force-push · NO git stash/reset in shared tree + no `git add -A` · install.sh under guard, agents NEVER write
~/.claude/skills (global authoritative, global→local only) · .claude/settings.json UNFROZEN · workers VISIBLE
tmux panes + close = kill-pane + TaskStop <name> + telemetry · dev-agents HARD-sandboxed OUTSIDE the gosleep
tree · DO NOT watch/narrate own context · pulse: heartbeat FIRST → wakeup EARLY (never last tool) → probes →
owner TEXT last.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub ainstance-labs/gosleep
(+ fixture ainstance-labs/gosleep-e2e-todo) · owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 ·
main @ 60cc5ae · PR #307 open (skills-management, owner review surface, NOT mergeable as-is).

## RESUME POINT — new orchestrator: SKILLS → PLUGINS migration research (owner mandate 2026-08-15)
⭐ **TASK 1 — RESEARCH + STRATEGY, deliver to owner as a document (not code-first).** The owner wants a fresh
orchestrator to figure out how to move us off "skills" and onto a "PLUGINS" system, and prepare the foundation.
His words, distilled:
- **The pain:** our skills — especially GLOBAL ones under ~/.claude/skills — have NO versioning and NO record
  of who changed what. It's inconvenient and unsafe. He wants versioning + provenance.
- **The goal:** the system should use PLUGINS instead of skills — "the same skills, but framed as plugins."
- **The questions to answer:** What IS a plugin, concretely? Is it just "a skill + versioning", or does it bring
  MORE advantages (bundling commands/agents/hooks/MCP servers, marketplaces, distribution, isolation, update
  channels)? What can we adopt? How do we build it RIGHT so we get versioning like we want, and the harness
  uses plugins not loose skills?
- **The scope: BOTH.** Global (~/.claude — the owner's cross-project skills) AND inside the gosleep project,
  which is becoming our HARNESS through which we work. Prepare the full foundation for both.
- **How to research (guidance):** Claude Code has a first-class PLUGINS system (marketplaces + plugins that
  bundle skills, slash-commands, subagents, hooks, MCP servers). Use the `claude-code-guide` agent and/or
  context7/web to research Claude Code's plugin + marketplace architecture specifically — plugin.json manifests,
  marketplace.json, versioning/update semantics, how a plugin's skills load, how a private/git-hosted
  marketplace works for versioned distribution. Map that against our reality: 7 owned skills in skill/ (source
  of truth: orchestrating-delivery-agents, delivery-workflow, handoff, using-jira, writing-prds, remote-control,
  tmux-agents-orchestration), the global ~/.claude/skills copies (authoritative), install.sh, gstack (a plugin
  suite already installed globally — study it as a working example of the plugin pattern we could adopt).
- **Deliver:** a strategy doc under docs/reports/ (or docs/prd/) — English — covering: what a plugin is + its
  advantages over our current skills, a recommended target architecture (how versioning + provenance work),
  a migration path (global + gosleep) that respects the "global authoritative / never auto-write ~/.claude/skills"
  safety rule, and open questions for the owner. Then a plain-language summary to the owner + a PRD/plan if he
  approves. Do the research with workers (visible panes, Opus 4.7 default; a research fan-out is appropriate) —
  the orchestrator coordinates, does not execute.

**TASK 2 (secondary):** PR #307 skills-management — when owner wants it, bring to mergeable+verified state
(merge origin/main into GSL-174-skills-management, resolve conflicts, re-run gates, fresh verification), owner
merges. It's a slice: registry/validator/publish tooling/skills screen/test-guard + GSL-186; no TouchID pieces.
Note the plugin migration may reframe how skills-management itself should work — flag any conflict to the owner.

## Gates
bun x tsc per package · bun test apps/core (292) · bash tools/lab/tests/core-smoke.sh (102) · web build ·
bash -n tools/hooks/*.sh. After editing skill/<name>/: targeted `rsync -a skill/<name>/ ~/.claude/skills/<name>/`
(NEVER install.sh whole, NEVER orchestrating-delivery-agents to global without owner). Publish via
tools/skills/publish.sh (never bypass) — but the plugin research may change this whole flow.

## Delivered this shift (all merged to main @ 60cc5ae)
GSL-311 (PR #317) · GSL-318 + GSL-325 harness interaction fixes (PR #324) · GSL-326 cosmetic polish (PR #330) ·
GSL-330 run-09 live-agent fixes (PR #335). Dossiers: docs/reports/verifications/web-e2e-2026-08-10/runs/03..10.

## Cold-start for the successor
Load skills (orchestrating-delivery-agents, tmux-agents-orchestration, handoff, delivery-workflow, using-jira)
→ THIS handoff → ORCHESTRATION-STATE.md → memory MEMORY.md. Sanity: git log origin/main -1 (60cc5ae),
gh pr list (PR #307 open), lab-emit list --count (open=0, lines=94), tmux list-panes (own pane only;
%0/%298/%307 = tasty-lunch, never touch). First heartbeat during cold-start. Then start the plugin research.

## Blocked on the human
- Owner reviews/merges PR #307 (predecessor never merges it).
- Owner reviews the plugin-migration strategy before any build; approves the PRD/plan.
- GSL-182-188: owner wants skill-lesson diffs before any global publish (likely reframed under plugins).
