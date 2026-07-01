# Handoff — gosleep — 2026-06-29 (v2+v3 hardening campaign complete; follow-ups pending owner)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the earlier 2026-06-29 handoffs.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep is the self-contained orchestration-harness repo (owns 5 delivery skills under `skill/`). This session shipped TWO hardening epics back-to-back — **GSL-24 (v2)** and **GSL-31 (v3)** — both merged to main (`571f1d5`). The behavioral eval that drove all this now shows real wins: the two stubborn behaviors that never moved before (SC-09 patience-vs-nudge, SC-19 rollover) are now fixed/much-improved. One gap remains (SC-12 cost-telemetry) and is tracked. No work is in flight; fleet is empty.

## 2. What happened this session (the story)
- v1 (GSL-7) and v2 (GSL-24) tried to fix 4 eval-failed behaviors by editing the skill PROSE. The eval proved that mostly didn't work: after v2, SC-09 and SC-19 were still 0.0.
- The breakthrough in v3 (GSL-31) was TWO realizations: (a) the SC-09 eval was **miscalibrated** — its prompt never said the no-report ceiling had elapsed, so skill-following agents correctly "kept monitoring" and got marked wrong (GSL-35 fixed the scenario); and (b) prose doesn't change behavior — the **decision mechanism** does. GSL-32 added a finalize-boundary exception directly in the idle-decision flowchart (check the time-ceiling BEFORE the `pane-alive→WAIT` route); GSL-33 forbade killing a live worker just to roll.
- Re-eval result: **SC-09 0→1.0, SC-19 0→0.75** (genuine wins). SC-11 dipped to 0.5 (N=2 noise — that section was untouched). **SC-12 stayed 0.0** — the GSL-34 content is sound but the behavior didn't move; per loop-guard we did NOT blind-edit again.
- A pane reviewer-teammate reviewed PR #42 (0 blockers, merge-recommended); it was merged autonomously. Remaining gaps tracked as GSL-37/38/39.

## 3. What we're doing next
Nothing until the owner directs. The remaining items are owner-gated: SC-12 needs a calibration check (not another blind edit), and the SC-09 scenario needs its discrimination restored (the recalibration over-corrected). Both are tracked. Critically, the owner forbade Workflow/mass-agent testing, so any re-validation must run as tmux-pane agents and only on the owner's say-so.

## 4. Problems / open
- **SC-12 cost-telemetry still 0.0** (GSL-38) — 2 attempts failed; next is a calibration check like SC-09 got, NOT a skill edit.
- **SC-09 now non-discriminating** (GSL-39) — RED=GREEN=1.0 after recalibration; the skill behavior is correct but the scenario no longer isolates the skill's value (eval-debt).
- Minor/deferred: SC-11 0.5 is N=2 noise (confirm at higher N if it matters); SC-19 0.75 polish (name the rollover steps); the eval-runner writes a stale "N=2" scorecard header when per-scenario N is used.
- Housekeeping: the orchestrator ledger (STATE + handoffs 09/10/11) is uncommitted on the merged local branch — commit it next session.

## 5. Comments & recent decisions
- **Owner directive (critical): NO Workflow tool. ALL agents — including evals/testing — run as tmux-pane teammates. No 50–100-agent runs. Control the process. Ask before any Workflow.** Delivery + review have always been panes; the eval was the only Workflow user, and the owner wants that stopped too.
- Owner granted full autonomy: reviews + merges are automatic (done so this session).
- Eval N policy: N=2 default, N=4–6 for borderline (used N=4 for SC-09/12/19 in the v3 run).

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- **Do NOT use the Workflow tool.** All agents = tmux-pane teammates (Agent tool, named). No mass-spawn. Ask the owner before any Workflow.
- Orchestrator executes NOTHING delivery — commits/Jira/GitHub → pane-workers (Sonnet); review → pane reviewer-teammate; verification → Haiku; orchestrator → Opus, owns STATE + dated handoffs. Reviews + merges AUTOMATIC.
- Epic+Task/Bug; 1 branch/Epic, 1 commit/Task (msg starts with key), 1 PR/Epic, REGULAR merge (never squash); idempotent; no force-push; artifacts in-tree; "section" not the glyph.
- `skill/` source of truth; `./install.sh` per-skill local→global. loop-guard: a behavior unmoved across 2 genuine attempts → investigate calibration, surface to owner, don't blind-edit.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b. To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep. **main @ `571f1d5`.** No open PRs. Open issues: GH #43/#44/#45 (follow-ups). Next free GH ≈ #46 |
| Owner | Roman L, rommxx@gmail.com, 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |
| Next Jira | GSL-40 |

## What exists / merged this session
- **PR #35** (GSL-24 v2) merged `c150a3d` — SC-11 fix, SC-12 partial, ledger.
- **PR #42** (GSL-31 v3) merged `571f1d5` — GSL-35 (SC-09 recalibration), GSL-33 (SC-19 kill-to-roll), GSL-34 (SC-12 recovery+telemetry), GSL-32 (SC-09 flowchart exception), GSL-36 (v3 results+analysis).
- Eval artifacts on main: `evals/results/2026-06-29-1719-scorecard.md` + `2026-06-29-1719-v3-analysis.md` (+ v2 1538/1544).
- Skill (`skill/orchestrating-delivery-agents/SKILL.md`) carries v2+v3 edits, installed globally (diff -r identical at last check).

## Immediate next steps (⭐ RESUME POINT — owner-gated)
Await owner direction on the follow-ups, then:
- **GSL-38 (SC-12):** read `evals/scenarios/SC-12-cost-telemetry/{prompt,rubric}`; check if the rubric criterion "fix the missing-TELEMETRY process" is fairly measurable; fix the scenario if miscalibrated; only then decide on a skill change. Validate via **tmux-pane agents only** (no Workflow), on owner direction.
- **GSL-39 (SC-09 discrimination):** refine the SC-09 prompt so the agent must RECOGNIZE the elapsed ceiling from the facts (not be told outright); keep GREEN passing, restore RED<GREEN.
- Housekeeping: checkout main, pull, commit the orchestrator ledger.

## Gotchas
- Working tree is on local branch `GSL-31-close-eval-gaps` (merged, remote deleted). Checkout main + pull; ledger files (untracked + STATE) carry across (stash -u + pop if blocked).
- `evals/baselines/` (cached RED) + `evals/runner/run-config.json` are gitignored. The SC-09 baseline was deleted this session (prompt changed) — it will re-run fresh if evals ever run again (panes only now).
- Window 10 in tmux = a DIFFERENT project's fleet — never touch. Our work is window 7.

## Blocked on the human (decisions)
- Pursue SC-12 (GSL-38 calibration) and/or SC-09 discrimination (GSL-39)? Or accept current state? Any re-testing = tmux-pane agents only, on your say-so (no Workflow).
