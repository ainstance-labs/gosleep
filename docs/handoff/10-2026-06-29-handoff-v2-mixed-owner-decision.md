# Handoff — gosleep — 2026-06-29 (v2 done, eval MIXED, owner decision pending)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the 2026-06-29 v2-execution handoff and the finalize-cycle handoff written earlier today.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep is the self-contained orchestration-harness repo (it owns 5 delivery/orchestration skills under `skill/`). We just finished **Harness hardening v2** (epic GSL-24): a second attempt to fix 4 agent behaviors that a behavioral eval had shown the v1 skill edits did NOT change. v2 made the edits CONCRETE and example-driven, then re-ran the eval. The result is **mixed** — it fixed some, not all. The v2 work is committed on a branch and **PR #35 is open, waiting for the owner** to decide what to do about the two behaviors that still won't move, and whether to merge.

## 2. What happened this run (the story)
- v1 (epic GSL-7) edited the skill text to fix 6 behavioral gaps. A behavioral eval (epic GSL-19) proved 4 of them did NOT change behavior — the edits were abstract prose.
- This run executed **v2** (epic GSL-24): rewrote those 4 fixes to be concrete, imperative, example-driven, naming the exact anti-pattern, placed in the scannable sections (Red flags / Quick reference). Five clean per-task commits (incl. an orchestration-ledger commit GSL-30).
- Then the orchestrator re-ran the eval (GSL-29) **under tight control** (a 1-scenario control test first, then the 4 scenarios, N=2, reusing cached RED baselines; an agent-count watchdog; no runaway — 6 + 18 agents total).
- **Result:** SC-11 FIXED (0.75→1.0). SC-12 improved (0.25→0.5, still below target). **SC-09 and SC-19 did NOT move (both still 0.0).**

## 3. What we're doing next
Nothing, until the owner decides. The autonomous run **stopped on purpose** (loop-guard): SC-09 and SC-19 have now failed across BOTH hardening epics, so blindly trying a third round of text edits is the exact thing the loop-guard exists to prevent. The owner reserved the "how to fix" approach decision, so it goes to them.

## 4. Problems we have
- **SC-09 (patience-vs-nudge) still 0.0**, with a suspicious inversion: RED (no skill) = 1.0, GREEN (with skill) = 0.0. The skill's strong, repeated "be patient / idle ≠ stuck / don't kill productive workers" message appears to overwhelm the new "send ONE concrete nudge" rule — a competing-guidance problem, not a lack of concreteness. The inversion also means the SC-09 scenario/rubric calibration is worth a second look.
- **SC-19 (rollover) still 0.0**, failure mode SHIFTED: v1 rolled while a worker was alive (orphaning it); v2 now makes the agent KILL a productive worker early (graceful shutdown_request) just to reach a clean boundary and roll sooner. The fix must forbid FORCING a boundary by terminating live work.
- **N=2 is coarse** — only 0 / 0.5 / 1.0 are expressible, so "≥0.8" effectively means "both samples pass". Borderline scenarios need a higher N for real signal (owner's cost call).

## 5. Comments & recent decisions
- The eval-control discipline held perfectly this run (control-test-first + watchdog + the runner's mechanism-level safety from GSL-23). The 242-agent incident class is closed: the control test confirmed the config now resolves to exactly the scenarios listed, never all-23.
- Merge of PR #35 is **owner-gated** (not auto-merged) — both because the owner flagged it and because the eval result is mixed.
- Meta-finding worth carrying: concrete skill-text edits reliably fix MECHANICAL behaviors (SC-11 = "what to write to STATE") but underperform for JUDGMENT-UNDER-TENSION behaviors where the skill holds competing principles (SC-09, SC-19). Those may need a single ordered decision-table/sequence in the skill, or a harness-level mechanism, rather than more prose.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- Orchestrator executes NOTHING delivery — all commits/Jira/GitHub/dev_history to pane-workers (Sonnet); verification = Haiku; orchestrator = Opus, only coordinates + owns ORCHESTRATION-STATE.md + writes a dated handoff at each boundary. The eval Workflow is the ONE orchestrator-run action, under control.
- Eval = background Workflow (NOT panes). NEVER fire-and-forget. Run ONLY via `evals/runner/run-config.json` (refuses without explicit scenarios; 120-agent ceiling throws before spawn). Control-test first + watch agent count + watchdog.
- Epic+Task only; 1 branch/Epic, 1 commit/Task (msg starts with key), 1 PR/Epic, REGULAR merge (never squash); idempotent; no force-push; artifacts in-tree (never /tmp); write "section" not the glyph.
- `skill/` is source of truth for all 5 skills; `./install.sh` per-skill local→global (never the parent).
- Loop-guard (active): SC-09/SC-19 unmoved across two epics → do not launch v3 autonomously; owner decides approach.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b. To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep. main @ `c46eb74`. **PR #35 OPEN (GSL-24, In Review, MERGEABLE, not merged).** Next free GH = #36 |
| Owner | Roman L, rommxx@gmail.com, 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |
| Next Jira | GSL-31 |

## Gates
No CI. For skill edits: `./install.sh` completes + `diff -r skill/orchestrating-delivery-agents ~/.claude/skills/orchestrating-delivery-agents` identical. For evals: the runner's resolved-config log + agent-count watchdog.

## What exists in code / current state
- Branch `GSL-24-hardening-v2` @ `e06f5e6` — 6 commits ahead of main: GSL-30 ledger (80b1e3f), GSL-25 SC-09 (a27f85a), GSL-26 SC-19 (d50426f), GSL-27 SC-12 (4174d7a), GSL-28 SC-11 (7f620df), GSL-29 scorecard+analysis (e06f5e6). All pushed.
- All GSL-24 child tasks (GSL-25/26/27/28/29/30) = **Done**. Epic GSL-24 = **In Review**. PR #35 open.
- Eval scorecards: `evals/results/2026-06-29-1538-scorecard.md` (control, SC-12) + `2026-06-29-1544-scorecard.md` (full 4). Analysis: `evals/results/2026-06-29-1544-v2-analysis.md`.
- Skill (`skill/orchestrating-delivery-agents/SKILL.md`) carries the v2 edits, installed globally (diff -r identical).

## Immediate next steps (⭐ THE RESUME POINT — owner-gated)
The owner must pick the approach for SC-09 + SC-19 (and the merge). Then:
- **If v3 (targeted):** branch off main after #35 merges (or continue on GSL-24-hardening-v2 if #35 not yet merged — but prefer a fresh GSL-31 epic). Concrete hypotheses ready: SC-09 → a single ordered decision-sequence (patience-window-elapsed? → exactly ONE nudge with example → escalate) that out-ranks the patience prose; SC-19 → forbid FORCING a boundary by killing live work (wait for the worker's natural COMPLETE; killing-to-roll is itself the anti-pattern). Then re-validate ONLY SC-09/SC-19 via the runner:
  `evals/runner/run-config.json = {"scenarios":["SC-09-stalled-at-pr","SC-19-orchestrator-rollover"],"samples":2,"useCachedRed":true,"skillDir":"<ROOT>/skill/orchestrating-delivery-agents","agentModel":"sonnet","judgeModel":"haiku"}` then `Workflow({scriptPath:"<ROOT>/evals/runner/eval-runner.js"})`. Control-test first; watch agent count. (Consider a higher N for clearer signal — owner's cost call.)
- **If merge #35:** a worker runs `gh pr merge 35 --merge` (regular, never squash), closes GH #28–34, transitions GSL-24 → Done, pulls main, deletes the branch.
- **If re-examine SC-09 calibration:** read `evals/scenarios/SC-09-stalled-at-pr/` (prompt.md + rubric.md) — the RED 1.0 > GREEN 0.0 inversion suggests the rubric may reward a behavior the skill discourages, or the scenario primes "keep monitoring".

## Read first
`evals/results/2026-06-29-1544-v2-analysis.md` (the per-scenario interpretation + meta-finding), the 1544 scorecard, ORCHESTRATION-STATE.md, and the GSL-24 Jira epic.

## Gotchas
- `evals/baselines/` (cached RED, mixed N) and `evals/runner/run-config.json` are gitignored (local cache). RED is skill-independent → cache reuse is free; only scenarios with no baseline run fresh RED (all 4 targets HAVE baselines).
- Window 10 in tmux is a DIFFERENT project's fleet — never touch it. Our work is window 7.
- N=2 coarseness (above). Eval agents are background Workflow, not panes — control by config, never fire-and-forget.

## Blocked on the human (the decision)
1. **Approach for SC-09 + SC-19** (text won't move them): (a) targeted v3 with the hypotheses above, (b) accept a harness/structural limit, or (c) re-examine SC-09 scenario calibration first.
2. **Merge PR #35?** (lands SC-11 fix + SC-12 improvement + ledger; v2 skill content is reasonable even where it didn't change behavior.)
3. **N policy** for future eval runs (N=2 is coarse).
