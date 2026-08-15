---
name: efficient-agent-evals
description: Use when evaluating an AI skill, prompt, or agent/harness's BEHAVIOR (designing or running evals) and cost matters — before launching any multi-scenario RED/GREEN or LLM-as-judge eval, or when an eval run spawned a huge number of judge/sample subagents or burned excessive tokens. Keeps the same eval signal at a fraction of the agents and tokens.
---

# Efficient Agent Evals

## Overview

Behavioral evals (testing a skill/prompt/agent, not deterministic code) are easy to make 3-10x more
expensive than they need to be. The waste is almost always: **one LLM judge per sample**, **re-running the
no-skill baseline every time**, and **using an LLM judge for decisions a regex could check**.

**Core principle: use the cheapest check that still produces the signal. Escalate to an LLM only when the
question is genuinely nuanced.** Most "did the agent do X / avoid Y" questions are deterministic.

## The cost ladder (try top-first)

1. **Deterministic assertion on structured output** — force the agent-under-test to emit a structured
   answer (e.g. `{next_action, rationale}`), then check it in code: did it call the forbidden tool? spawn a
   duplicate? read the transcript? No judge agent, no sampling noise, ~1 agent per case. Use for every
   yes/no or contains/avoids check (usually the majority).
2. **Batched LLM judge** — when wording is nuanced, ONE judge call scores ALL N samples of a scenario
   (ideally both arms) in a single prompt. Not one judge per answer.
3. **Pairwise A/B judge** — judge compares the with-skill answer against the no-skill answer directly. More
   reliable than absolute scoring and shows the lift in one call.
4. **Per-sample LLM judge** — the most expensive; only for deep, per-answer rubric grading. Avoid as the default.

## Cost rules (always)

- **Cache the RED baseline.** The no-skill control depends on the SCENARIO, not the skill. Run it ONCE,
  store the pass-rate. When you change the SKILL, re-run GREEN only. (RED is a one-time cost, not per-iteration.)
- **Right-size N — low by default, high only to confirm.** N measures variance in the AGENT's behaviour,
  not the judge, so it is the only place sampling is needed. Deterministic-checked scenarios need N=1 (no
  variance in the check itself, only in whether the agent acts right — so a small N still estimates the
  rate). Use **N=3-4 for routine iteration** ("did it clearly improve?"). Raise to **N=8-10 ONLY on the few
  scenarios where you are making the pass/fail call** that a gap is fixed (a stable rate) — this is
  affordable precisely because judges are batched/eliminated, so a sample costs one answer, not three.
  **Do not fix N=6 for everything:** it is the worst middle — too few for a stable rate (rates swing run to
  run), yet enough to be expensive.
- **Tier the runs.** On each skill edit: smoke only the CHANGED scenarios at low N. Full suite: rarely.
- **Stay within the rate/usage limit in one run.** A run that hits the limit forces a resume that often
  re-does the whole suite (a near-duplicate). Smaller N + batching keeps one run whole.
- **Separate prompt from rubric on disk** (agent-under-test reads only the situation; the check/rubric is
  judge-only) so the agent can't cheat.

## Quick reference

| Question type | Use | Cost |
|---|---|---|
| "did it do/avoid X" (yes/no) | deterministic assertion on structured output | ~1 agent/case |
| nuanced quality across N samples | 1 batched judge per scenario | ~1 agent/scenario |
| "is GREEN better than RED" | pairwise A/B judge | ~1 agent/pair |
| no-skill baseline | run once, cache | one-time |

## Why this skill exists (the evidence)

A real run of a 20-scenario RED/GREEN suite at N=6 spawned **480 agents per run** — and **judges were 50%
of them** (one judge per answer: 6 RED + 6 GREEN answers + 6 + 6 judges per scenario). A weekly-limit
interruption then forced a near-duplicate resume → **~1026 agents / ~20.6M tokens total**. The signal was
real (it found 8 genuine gaps), but the cost was ~2-3x inflated. Batching the judge (-~40% agents), caching
RED (-~half of reruns), and moving the many yes/no scenarios to deterministic assertions would have given
the same result at roughly **one third** the tokens, with less sampling noise.

## Common mistakes

- One judge per sample (batch instead).
- Re-running RED on every skill iteration (cache it).
- LLM-judging a yes/no decision (assert it).
- N=6+ "to be safe" on a noisy judge (right-size; or make it deterministic).
- Letting a limit-interrupted run resume into a full re-run (keep one run within budget).

**Related:** `superpowers:writing-skills` (skill TDD), `orchestrating-delivery-agents` (the harness these evals test). Mature frameworks worth adopting over a bespoke runner: promptfoo, Inspect (AISI), OpenAI Evals, Braintrust, DeepEval (verify current capabilities before choosing).
