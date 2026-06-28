# GSL-21 — Validation run scorecard + analysis

**Task:** GSL-21 | **Epic:** GSL-19 — Eval validation | **Branch:** GSL-19-eval-validation

---

## Part 1 — What was done (plain words)

### The run

This task is the capstone of GSL-19: run the full scenario suite in a controlled, efficient way and
record an honest scorecard of whether the GSL-7 harness-hardening fixes actually changed behavior.

We ran a **controlled 86-agent behavioral evaluation** using the now-efficient runner (GSL-20/22/23).
The RED (no-skill) baseline was re-used from a cached prior run (`useCachedRed: true`) — avoiding a
repeat of the earlier uncontrolled 242-agent incident. GREEN (with-skill) responses were generated
fresh. All 12 active scenarios were evaluated at **N=4** per scenario.

Scorecard written to: `evals/results/2026-06-29-0028-scorecard.md`.

### Verdict table

| Scenario | RED | GREEN | Delta | Verdict |
|---|---|---|---|---|
| SC-04-crossed-late-message | 0.67 | 1.00 | +0.33 | **PASS** |
| SC-07-no-sendmessage-worker | 0.00 | 1.00 | +1.00 | **PASS** |
| SC-21-hung-browser-verifier | 0.00 | 1.00 | +1.00 | **PASS** |
| SC-22-verify-request | 0.00 | 1.00 | +1.00 | **PASS** |
| SC-03-orchestrator-recovery | 1.00 | 1.00 | 0.00 | GUARD |
| SC-16-idempotent-create | 1.00 | 1.00 | 0.00 | GUARD |
| SC-20-context-discipline | 1.00 | 1.00 | 0.00 | GUARD |
| SC-23-verification-watchdog | 1.00 | 1.00 | 0.00 | GUARD |
| SC-09-stalled-at-pr | 1.00 | 0.00 | -1.00 | **FAIL** |
| SC-11-suspect-handoff | 0.00 | 0.75 | +0.75 | **FAIL** |
| SC-12-cost-telemetry | 0.17 | 0.25 | +0.08 | **FAIL** |
| SC-19-orchestrator-rollover | 0.00 | 0.00 | 0.00 | **FAIL** |

### What landed / what held

**Fixes that demonstrably changed behavior (PASS):**
- **SC-04** — The crossed-late-message fix landed: GREEN jumped from 0.67 → 1.00.
- **SC-07** — The SendMessage worker fix landed cleanly: RED 0.00 → GREEN 1.00.

**New discriminating scenarios (PASS by design):**
- **SC-21** (hung browser verifier) and **SC-22** (verify-request) were authored as part of GSL-13
  and validate new skill surface. Both score RED=0.00 → GREEN=1.00, confirming they discriminate
  well and are valid test cases for future runs.

**Skill holds existing good behavior (GUARD):**
- SC-03, SC-16, SC-20, SC-23 all score 1.00/1.00 — the skill was already strong here and the
  hardening did not regress any of them.

### Key finding — 4 of 6 GSL-7 fixes did NOT land behaviorally

The core GSL-7 hardening (epic) targeted 6 skill-text changes across GSL-8 through GSL-13.
The eval reveals that **4 of those 6 fixes produced no measurable GREEN improvement**:

| Scenario | GSL-7 fix targeted | Anti-pattern observed |
|---|---|---|
| SC-09 | GSL-11 patience-vs-nudge (PR boundary) | Vague "keep monitoring" / "wait and see" — no single committed nudge |
| SC-19 | GSL-10 rollover boundary | Rolls over while a worker (cycle-13) is still alive → orphans it |
| SC-12 | GSL-10 telemetry recovery | Does not fix the missing-TELEMETRY process |
| SC-11 | GSL-9 state mechanics | Incomplete state-update mechanics for handoff validation (GREEN=0.75 < 0.80) |

The skill text was updated, but the model's behavior under these scenarios did not shift enough to
cross the passing threshold. This is a known phenomenon in LLM-skill work: text-level edits to skill
instructions do not always transfer reliably to in-context behavior — particularly for nuanced
multi-step procedural constraints.

**A follow-up "harness hardening v2" epic is warranted** to address these four gaps with more
structural interventions (examples, decision trees, explicit failure modes, possibly new eval
scenarios as regression anchors). That epic has not been created; it is saved as an owner decision.

---

## Part 2 — Technical reference

### Run parameters

| Parameter | Value |
|---|---|
| Total agents spawned | 86 |
| Under-test model | claude-sonnet (latest) |
| Judge model | claude-haiku (latest) |
| N per scenario | 4 |
| Scenarios evaluated | 12 |
| RED baseline | Cached (reused, `useCachedRed: true`) |
| GREEN baseline | Fresh generation |
| Scorecard | `evals/results/2026-06-29-0028-scorecard.md` |

### Safety controls (preventing a repeat of the 242-agent incident)

The earlier uncontrolled run (control test, scorecard `2026-06-29-0009`) spawned 242 agents due to
no per-scenario N cap and no agent ceiling. The following controls were in place for this run:

1. **`useCachedRed: true`** — RED baseline loaded from `evals/baselines/` cache; no RED agents
   spawned. This alone cut 50%+ of potential agent usage.
2. **Per-scenario N cap** (GSL-20) — each scenario runs exactly N=4 GREEN + 4 judge calls;
   no unbounded loops.
3. **Agent ceiling** (GSL-23) — `maxAgents` hard ceiling in `run-config.json` with no-silent-full-run
   guard; run aborts cleanly rather than ballooning.
4. **Cost-appropriate models** (GSL-22) — Haiku for judging (batched, deterministic rubric), Sonnet
   only for under-test generation.
5. **File-based run-config** (GSL-23) — `run-config.json` is gitignored and must be created
   explicitly; no scenario list defaults to full-run.

The `evals/baselines/` directory is gitignored (local derived artifact, mixed N, not source of
truth). The scorecard is the committed record.

### Commit

`GSL-21 Validation run scorecard + analysis (4 fixes landed/held, 4 need rework)`
