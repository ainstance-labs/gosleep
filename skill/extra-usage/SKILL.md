---
name: extra-usage
description: Use when the owner opts into spending at maximum — "lots of tokens", "use the best models", "ultra mode", "go wide", "don't ration", "maximum usage" — and the default token-economy policy (Sonnet verification, no orchestrator workflows, small capped fan-outs, budget/loop-guard) is too conservative. An opt-in session modifier that lifts ONLY the economy rails, never the safety rails. Symptoms you're about to under-spend: defaulting to Sonnet verification, skipping the Workflow tool, or capping fan-out purely to save tokens after the owner said to go big.
---

# extra-usage

## Overview

extra-usage is an **opt-in session modifier**. When active, it lifts the token-economy rails: every subagent runs on the **best model (Opus)**, the **Workflow tool and ultracode multi-agent fan-outs are unlocked**, and the **budget / loop-guard / fan-out caps are off**. It changes ONLY economics.

**Core principle: abundance changes economics, never safety.** extra-usage spends more tokens and uses better models to get more thorough, higher-confidence results. It NEVER authorizes irreversible or out-of-repo actions you would otherwise pause for. Every safety rail stays exactly as it was.

## When to use

- The owner explicitly signals abundance: "lots of tokens", "work at maximum", "use the best models", "ultra mode", "go wide", "don't ration".
- A large pile of tasks where thoroughness beats frugality.
- You're about to default to Sonnet verification / skip the Workflow tool / cap fan-out **purely to save tokens** — and the owner has opted into spending.

**When NOT to use:**
- The owner hasn't opted in — the default is the economy policy. Do not self-activate.
- A genuinely trivial one-off. The mode raises the ceiling; it does not *mandate* a fan-out on a single-line edit. Use judgment — spend where it buys quality.

## What it overrides — the economy rails ONLY

| Dimension | Default (economy) | extra-usage (active) |
|---|---|---|
| Verification model | Sonnet | **Opus** (best available) |
| Worker / reviewer model | Opus | Opus (already best) |
| All other subagents (verifiers, skeptics, utility) | often Sonnet | **Opus across the board** |
| Workflow tool | banned (orchestrator + workers) | **unlocked** — author multi-agent workflows, visible in `/workflows` |
| ultracode multi-agent | off | **on** — rich fan-outs (adversarial verify, judge panels, loop-until-dry) |
| Fan-out size | ~6-8 cap | **go wide** — scale to the task |
| Token ceiling / loop-guard economy | enforced | **lifted** — spend to maximize quality + coverage |
| Verification depth | 1 verifier + 1 skeptic | multiple independent verifiers / perspective-diverse panels |

**Composing with `orchestrating-delivery-agents`:** when both are active, extra-usage overrides that skill's *economy* clauses — its Sonnet-verification model-split (→ Opus) and its "orchestrator runs no workflows" (→ the orchestrator MAY author Workflow fan-outs). Everything else in orchestrating-delivery-agents stays: lifecycle, handoffs, the execute-nothing-heavy-inline longevity discipline, one-editor-per-tree.

## What it does NOT touch — safety rails stay fixed

extra-usage is an **economy switch**, not a permission grant. These remain identical to mode-off:

- **The denylist stays the denylist** — force-push / rewriting published history, deleting branches/tags/releases, prod deploys beyond auto-Vercel, secret rotation, destructive DB migrations on shared data, external comms, deleting cloud/infra resources → STILL surface as `BLOCKED_ON_HUMAN`. "Maximum tokens" authorizes throughput, never irreversible risk.
- **One editing cycle per working tree; never force-push a shared branch.**
- **Orchestrator longevity** — still keep state on disk; still don't read heavy files into your context. Workflow results come back as **compact summaries + report files**, never raw dumps into your window.
- **Verify before asserting** — more agents is not a license to skip verification. Spend the abundance *on* verification (adversarial / perspective-diverse panels); never spend it *skipping* checks.

## Rationalizations — STOP, these are wrong when extra-usage is ON

| Thought | Reality |
|---|---|
| "Lots of tokens doesn't change the execution model." | With extra-usage ON it DOES — that is the entire point. Unlock Workflow + ultracode. |
| "The token-economy cap is structural, not a budget I relax." | extra-usage explicitly lifts it. The 29-agent-burn lesson governs the DEFAULT; an opt-in abundance signal overrides it. |
| "Verification stays on Sonnet for economy." | Under extra-usage verification runs on **Opus** — best model everywhere. |
| "Keep fan-out small to be safe." | Token-frugality is not a *safety* rail. Go wide; scale to the task. |
| "Maximum means I may also force-push / deploy / drop data." | NO. Maximum = economics only. The safety denylist is untouched. |

## Activate / deactivate

- **Activate:** invoke this skill (`extra-usage`) at session start, or whenever the owner signals abundance. It holds for the session.
- **Deactivate:** the owner asks to return to economy mode, or a fresh session starts. When off, the default economy policy resumes (Sonnet verification, no orchestrator workflows, capped fan-outs).
- **Composes with** other skills (orchestrating-delivery-agents, delivery-workflow). On conflict, extra-usage wins **on economics**; their **safety/process** rules still hold.

## Common mistakes

- Treating it as "ignore all rules" → it is economics-only; safety is fixed.
- Forcing a fan-out onto a trivial task → the mode raises the ceiling, it doesn't mandate waste.
- Letting Workflow dump raw results into the orchestrator's context → still return compact summaries + report files (longevity rail).
