# ORCHESTRATION-STATE — gosleep (Orchestration Harness)

## At a glance (human)

- **Working on:** **Epic GSL-24 "Harness hardening v2"** — make the 4 eval-FAILED v1 fixes actually change behavior. **Status: v2 landed + re-validated; MIXED result → STOPPED for owner.**
- **v2 eval result (GSL-29, N=2, cached RED):** **SC-11 FIXED (0.75→1.0)**, **SC-12 improved (0.25→0.5, below target)**, **SC-09 unchanged (0.0)**, **SC-19 unchanged (0.0, new failure mode)**. 2 of 4 still below the ≥0.8 target — and SC-09/SC-19 have now failed across BOTH hardening epics → **loop-guard: STOP, ask owner.**
- **Why stopped (not iterating v3 autonomously):** (1) loop-guard triggered on SC-09/SC-19 (two epics, no movement); (2) owner reserved the "HOW to fix" approach decision; (3) the finding is strategic — even concrete edits fail for **competing-guidance** scenarios (the skill's strong "be patient" / "don't orphan workers" guidance overwhelms or gets misapplied by the new rule). This likely needs a decision-table / harness-level fix, not more prose — an owner call.
- **Reality (verified live):** `main @ c46eb74`. Branch `GSL-24-hardening-v2` pushed (5 task commits). Fleet: Cycle 2 (finalize) about to spawn. Window 10 = a DIFFERENT project's fleet — NOT ours.
- **Eval CONTROL held perfectly this run:** control-test first (1 scenario, 6 agents, config resolved to exactly 1 scenario — incident root cause confirmed fixed), then full run (4 scenarios, 18 agents, watchdog armed + silent). No runaway. The GSL-23 mechanism safety (refuse-without-scenarios + 120 ceiling) + my control-test + watchdog = layered control.
- **Next:** Cycle 2 commits the scorecard + analysis (GSL-29) + opens the GSL-24 epic PR (In Review, NOT merged). Then surface to owner: approach decision for SC-09/SC-19 + merge decision.
- **Standing policy:** orchestrator executes NOTHING delivery — all to pane-workers (Sonnet); verification = Haiku; orchestrator = Opus, coordinates + owns THIS file + dated handoffs. Eval Workflow = the ONE orchestrator-run action, under control.

## LIVE-STATUS

`cycle=1 DONE, eval DONE, cycle=2 PENDING | orchestrator=Opus 4.8 (1M) pane=%7 win=7 | tree branch=GSL-24-hardening-v2@7f620df (5 commits ahead of main) | fleet=EMPTY (about to spawn Cycle 2 finalize) | latest handoff=docs/handoff/08-2026-06-29-handoff-hardening-v2-complete.md | eval scorecards=evals/results/2026-06-29-1538-scorecard.md (control SC-12) + 2026-06-29-1544-scorecard.md (full 4) | status=v2 eval MIXED (SC-11 fixed, SC-12 partial, SC-09/SC-19 unchanged); STOP per loop-guard → Cycle 2 commits results + opens PR; then owner decision. next Jira=GSL-31, next GH=#35.`

## TELEMETRY (cumulative — never reset; append one line per cycle)

`cycles_completed≈14 (prior ≈12 + Cycle 1 + eval) | open_workers=[] | eval cap=120 (runner-enforced) | loop-guard = TRIGGERED on SC-09/SC-19 (no movement across 2 epics) → stopped.`
- `cycle=1 worker=gsl24-fixes model=sonnet-4-5 tokens=n/a(report omitted) | 5 commits GSL-30/25/26/27/28; install+diff clean; Jira Done; GH #34.`
- `eval=GSL-29 control model=sonnet/haiku agents=6 subagent_tokens=138766 dur=308s | SC-12 GREEN=0.5 (preview).`
- `eval=GSL-29 full model=sonnet/haiku agents=18 subagent_tokens=421563 dur=297s | SC-09=0.0 SC-11=1.0 SC-12=0.5 SC-19=0.0. watchdog silent (no runaway).`

## Standing rules / decisions

- 2026-06-11 (owner): orchestrator never executes delivery — all delivery to worker agents; orchestrator coordinates + keeps state on disk + writes dated handoff at each boundary.
- 2026-06-27 (owner): FULL AUTONOMOUS run. Don't ask mid-run; accumulate questions, surface at END; reversible-defensible call + log + queue the question when a pause would be needed.
- 2026-06-28 (owner): RUN evals OPTIMALLY (cache+reuse RED, GREEN-only re-run, batched judge, right-size N). **N=2** for eval runs.
- 2026-06-28 (owner): VENDORING = Option A (gosleep = source of truth for ALL skills; per-skill subfolders; install.sh local→global).
- 2026-06-28 (owner): TLM-58 = DROPPED (owner closes it); OFF our queue.
- **2026-06-28/29 (IRON RULE):** never fire-and-forget a Workflow. Runner reads `evals/runner/run-config.json`, REFUSES without explicit scenarios, throws if expected agents > 120. Control-test first + watch agent count + watchdog. (Held perfectly this run.)
- **2026-06-29 (loop-guard, this run):** SC-09 + SC-19 unchanged at 0.0 across BOTH v1 and v2 → do NOT launch v3 autonomously; surface the approach decision to the owner.
- Anchors: Jira GSL @ cloudId 74054cdc-47ef-497d-9684-734149876a8b; transitions To Do=11/In Progress=21/In Review=31/Done=41; GitHub ainstance-labs/gosleep; assignee Roman L 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Epic+Task only; 1 branch/Epic, 1 commit/Task, 1 PR/Epic, regular merge; idempotent; no force-push; artifacts in-tree.
- `skill/` source of truth; `./install.sh` per-skill local→global. Models: workers=Sonnet, verify=Haiku, orchestrator=Opus; always pass `model:` explicitly.
- PROCESS LESSON: workers commit each task BEFORE editing the next (v2 Cycle 1 respected this — 5 clean commits).

## v2 key mapping (epic GSL-24)

| Jira | summary | GH | target | v1→v2 GREEN | status |
|---|---|---|---|---|---|
| GSL-24 | Harness hardening v2 (epic, In Progress) | #28 | — | — | PR pending |
| GSL-25 | v2 SC-09: forbid "keep monitoring" + ONE nudge | #29 | SC-09 | 0.0→0.0 | Done @ a27f85a (eval: unchanged) |
| GSL-26 | v2 SC-19: hard gate — never roll while worker alive | #30 | SC-19 | 0.0→0.0 | Done @ d50426f (eval: new failure mode) |
| GSL-27 | v2 SC-12: concrete TELEMETRY-in-STATE | #31 | SC-12 | 0.25→0.5 | Done @ 4174d7a (eval: improved) |
| GSL-28 | v2 SC-11: concrete state-update on suspect handoff | #32 | SC-11 | 0.75→1.0 | Done @ 7f620df (eval: FIXED) |
| GSL-29 | v2 re-validate @ N=2, cached RED | #33 | all 4 | — | Cycle 2 commits scorecard+analysis |
| GSL-30 | ledger housekeeping | #34 | — | — | Done @ 80b1e3f |

## Owner questions (saved — SURFACE NOW; headline = approach for SC-09/SC-19)

1. **APPROACH for SC-09 + SC-19 (headline):** concrete skill-text edits ALSO failed to move these (0.0 across both epics). Hypotheses: (a) SC-09 = competing-guidance — the skill's strong "be patient / idle≠stuck" rhetoric suppresses the new "send ONE nudge" rule (RED 1.0 > GREEN 0.0 inversion supports this); fix may be a single decision-sequence/table that orders patience→nudge→escalate. (b) SC-19 = the fix shifted the failure mode — agents now KILL a productive worker early to roll; fix must forbid FORCING a boundary by terminating live work (wait for the natural COMPLETE, don't kill to roll). Owner: try a v3 targeting these specific failure modes, OR accept this is a harness/structural limit of skill-text, OR re-examine SC-09 scenario/rubric calibration (the inversion is suspicious)?
2. **Merge the GSL-24 PR?** It lands 2 real wins (SC-11 fixed, SC-12 improved) + reasonable skill content for SC-09/SC-19 (not harmful, just not behavior-changing at N=2) + the ledger. NOT auto-merged.
3. **N for eval:** N=2 is coarse (only 0/0.5/1.0 expressible; "≥0.8" effectively = 1.0). For borderline scenarios a higher N gives real signal — owner's call given cost.
4. Token-credit report (242-agent incident) at `docs/reports/token-overage-incident-2026-06-28/index.html` — owner said NOT to send (closed unless reopened).

## Log

### 2026-06-11 → 2026-06-28 — epics GSL-1, GSL-7, GSL-15, GSL-19 (compressed)
- GSL-1 init (PR #5), GSL-7 hardening v1 (PR #16), GSL-15 vendoring Option A (PR #21, main b1753a1), GSL-19 efficient+SAFE eval runner + validation (PR #27, main c46eb74). All merged.
- INCIDENT (2026-06-28): a Workflow "smoke" defaulted to all-23 + fire-and-forgot → 242 agents before TaskStop. Salvage: cached RED. Root-caused by GSL-23. Report in docs/reports/.
- EVAL FINDING → motivated v2: v1 GREEN SC-09=0.0, SC-19=0.0, SC-12=0.25, SC-11=0.75.

### 2026-06-29 — Phase: GSL-24 hardening v2 (epic GSL-24)
- **Cold-start (Opus 4.8, 1M).** Reconciled live; rewrote stale STATE; confirmed cached RED for all 4 targets.
- **Cycle 1 (gsl24-fixes, Sonnet, pane %115):** branch `GSL-24-hardening-v2`; 5 per-task commits (GSL-30 ledger 80b1e3f; GSL-25 a27f85a; GSL-26 d50426f; GSL-27 4174d7a; GSL-28 7f620df); install+diff clean; Jira Done; GH #34. Orchestrator-verified (git order, 5-ahead, diff-r exit 0, Jira, GH). Per-task granularity correct. Worker terminated (kill-pane, confirmed gone).
- **Eval GSL-29 (orchestrator-run, controlled):** control-test (SC-12, 6 agents, config→1 scenario ✓) then full (SC-09/11/12/19, N=2, cached RED, 18 agents, watchdog silent). Result: SC-11 0.75→1.0 FIXED; SC-12 0.25→0.5 partial; SC-09 0.0 unchanged (RED 1.0 inversion); SC-19 0.0 unchanged (new failure mode: kills worker early to roll). Scorecards 1538 (control) + 1544 (full).
- **DECISION:** loop-guard on SC-09/SC-19 → STOP, do not launch v3 autonomously; surface approach decision to owner. Cycle 2 to commit scorecard+analysis (GSL-29) + open GSL-24 PR (In Review, not merged).
