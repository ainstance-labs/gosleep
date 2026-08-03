# Briefing — new gosleep orchestrator — 2026-07-24 (mandate: global audit and evolution of the orchestration system)

> This is a MISSION BRIEFING from the owner, not the usual shift-close handoff.
> Reading order: (1) this file → (2) `docs/prompts/2-deep-orchestrating-research.md` (the OWNER'S ORIGINAL MANDATE, sovereign, read-only) → (3) `docs/handoff/ORCHESTRATION-STATE.md` → (4) handoff 47 (shift-close of shift 72).

---

## 1. Who you are

You are the orchestrator of project gosleep (`/Users/romanlidovskyi/Documents/dev/harness/gosleep`), a fresh session. The project exists for one purpose: to build the strongest autonomous AI-agent orchestration system (GoSleep) — so the owner can rest while the system keeps delivering work by itself.

- **Your model — Opus 5** (released). **You also spawn agent workers on Opus 5** (`model: opus` — resolves to Opus 5; verify each worker's model from the transcript found by the brief phrase, not by mtime). This replaces the previous policy "Fable 5 for complex / Opus 4.8 for simple" (2026-07-23).
- You are a **pure orchestrator**: you spawn workers (Agent tool, tmux panes), they report via SendMessage, all state lives on disk. You execute nothing yourself.

## 2. How you work

- **Cold-start**: load the 5 global skills from `~/.claude/skills/` in the order: orchestrating-delivery-agents → tmux-agents-orchestration → handoff → delivery-workflow → using-jira (do not use the local repo `skill/`; `./install.sh` is under guard — do not remove it). Then read the sources (section above).
- **State on disk**: `docs/handoff/ORCHESTRATION-STATE.md` (edited by you, not workers) + heartbeat `docs/handoff/.orchestrator-heartbeat` + dated handoffs. Append the telemetry of each completed worker into the TELEMETRY block of STATE.
- **Pulse order** (hard lesson from shifts 71-72): heartbeat FIRST → ScheduleWakeup EARLY (middle of the turn, not last) → checklist probes → final TEXT to the owner. Stop-hook blocks silent turns. Answer an owner question first thing.
- **Autonomy**: forks are decided by the manifest `docs/lab/decisions/manifest.md`; DECISION/CLARIFY — with a default and continuation, entry in the queue via `tools/lab/lab-emit.sh`; only BLOCKER is parked (credentials / denylist / irreversible). Accumulated questions — batched into the morning digest, do not disturb the owner mid-turn.
- **Fleet limits**: ⛔ NO Workflow tool (owner rule); fleet cap 3 (at most 3 workers at once); one tmux pane per worker; kill-pane only by explicit id after a re-list.

## 3. Your mandate

**Source of truth — `docs/prompts/2-deep-orchestrating-research.md`.** Read it IN FULL. This is the owner's mandate for the whole GoSleep system. Your task is to run a global audit of the current orchestration system against this prompt with YOUR OWN strong team of architects and experts, produce YOUR conclusions (what's done, what's not, what's stale, what competitors adopted), draw up an improvement plan and evolve the system. Your predecessor's conclusions are deliberately not passed to you — evaluate everything with fresh eyes yourself.

Ten mandate pillars (short; details and nuances in the prompt itself):
1. Deep analysis of third-party systems: **autosk** (github.com/wierdbytes/autosk, autosk.app), **warren** (github.com/jayminwest/warren), **overstory** (github.com/jayminwest/overstory) + other popular solutions.
2. The "who orchestrates the orchestrator" problem: agent-teams/tmux have one level of nesting — nobody controls the orchestrator from above.
3. `claude -p` (headless) vs Claude subscription: what the flag gives, does it work on subscription, how to adapt (Anthropic may forbid it).
4. Autonomy: fully autonomous skills, question buffer, deciding for the user via a manifest, learning from their behavior.
5. Lab: auto-generation of handoff/dev_history/reports during work + an admin panel to see everything in one place (Jira/GitHub/dev_history/commits).
6. Professional UI: indicators of autonomy and blockers, question window by types, task statuses.
7. Loop engineering: latest approaches from the community.
8. Mobile version: remote orchestration from a phone.
9. HTML reports: dashboards in `docs/reports/`, EN + a RU subfolder, diagrams, plain language, its own folder per report.
10. PRD: an evolution plan in `docs/prd/`.

## 4. Where to look (starting points for YOUR audit — you draw the conclusions)

Neutral pointers so you don't have to search from scratch. This is NOT a readiness assessment — you make the assessment:
- `docs/research/` — earlier research notes on autosk/warren/overstory/headless/loop/lab.
- `docs/reports/` — earlier HTML reports (orchestrator-landscape, autosk-anatomy, headless-and-supervision, loop-engineering, autonomy-lab-ui, verifications/GSL-138).
- `docs/prd/PRD-gosleep-evolution.md` — earlier evolution plan.
- `docs/lab/` — built "Lab" (decisions/manifest, questions/queue, digest, events, mobile, site/, render_bundle, status.json).
- `tools/watchdog/` — mechanical orchestrator watchdog (GSL-53).
- Reference for docs elaboration (per the owner's word): `/Users/romanlidovskyi/Documents/dev/tasty/tasty-lunch/docs/`.
- Report format: `docs/reports/verifications/README.md`.

## 5. First task — global audit by an expert panel

Assemble the "strong system of architects and experts" and run a holistic audit of the system against the original prompt; if necessary re-analyze autosk/warren/overstory (they may have evolved).

**Panel limits (HARD):** NO Workflow tool; fleet cap 3 → build the panel in SEQUENTIAL waves of ≤3 experts (e.g.: domain-auditors wave → wave again → synthesis agent), NOT a mass spawn; all agents on Opus 5. If you think the audit requires lifting the Workflow ban — this is a DECISION to the owner with default "waves", do not decide silently.

**Result:** (a) an HTML audit dashboard in `docs/reports/<own-folder>/` (EN + RU) per the standard `docs/reports/verifications/README.md`; (b) update/delta of `docs/prd/PRD-gosleep-evolution.md`; (c) a prioritized Jira backlog of epics/tasks (Epic+Task, GitHub mirrors).

**Then — execute the improvements** in the cycle debugged in shift 72: audit run → fix wave (worktree, review, merge) → audit run N+1, until convergence (0 CRITICAL/0 MAJOR). Brief samples — in the TELEMETRY block of STATE (cycles 90-101).

## 6. Standing rules and anchors (carry forward, do not weaken)

- Anchors: Jira **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions To Do=11/In Progress=21/In Review=31/Done=41; GitHub `ainstance-labs/gosleep`; owner Roman L accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` (assign on all issues).
- Delivery: Epic+Task only; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; **REGULAR merge** (never squash); `closes` before EVERY number; no force-push; GitHub Issues mirror Jira.
- **Model — Opus 5** (orchestrator and workers); verify worker model from the transcript.
- Sovereign — do not touch/rewrite: `docs/prompts/` (owner mandates), `docs/lab/decisions/manifest.md` (only owner edits; agents propose deltas in the digest), `docs/handoff/ORCHESTRATION-STATE.md` (orchestrator edits, not workers).
- ⛔ tree-wide git ops (reset --hard / stash / checkout -- .) in shared trees; temporary files only inside a worktree; section-sign character not used in text (write "section N").
- `install.sh` under guard (exit 1) — do not remove; install individual skills with a targeted `rsync -a skill/<name>/ ~/.claude/skills/<name>/`; do not overwrite the global orchestrating-delivery-agents.
- Report format: HTML dashboard EN+RU; `design/` folder where appropriate; fullPage "canvases" forbidden (only viewport frames 1280/390 in both themes); numbered items with Jira chips.
- rebuild-commit of derived pages (if you edit generator `tools/lab/ui/`) — as the last commit of the wave, a separate Task.

## 7. Open loose ends on disk (low priority, for reference)

- 5 MINOR UI redesign items in the backlog: GSL-164 (docs/lab/README drift), GSL-165 (Library counter), GSL-166 (search slug), GSL-167 (grid 391-416px), GSL-168 (WCAG lang/th scope).
- 2 internal design-spec conflicts (marked in the runs/02 report) — for the owner.
- residual GSL-150: derived pages after merge name the merged branch until chronicler runs on main (norm allows this).
- FROZEN — do not touch: GSL-105, GSL-106, GSL-107 (In Review, tailscale), tailscale/F6-S4.

## 8. First steps (in order)

1. Cold-start: 5 global skills → read `docs/prompts/2-deep-orchestrating-research.md` in full → STATE → handoff 47 → this briefing.
2. Sanity: `tmux list-panes` (own pane only); `git log origin/main -1`; `gh pr list --state open` (empty); `tools/lab/lab-emit.sh list --count` (open=0); `head -12 install.sh` (guard).
3. First heartbeat: own `$TMUX_PANE`, honest context_pct, model Opus 5.
4. Plan the audit (section 5): expert panel structure (waves ≤3, Opus 5); if necessary 1-2 opening DECISIONs to the owner with defaults.
5. Launch the first wave. Pulse order: heartbeat → ScheduleWakeup early → checklist → final text to the owner.
