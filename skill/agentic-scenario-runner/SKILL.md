---
name: agentic-scenario-runner
description: Use when runs, samples, evals, or a model comparison are on the table for an AI agent/LLM behaviour — before spending any API calls or agent-hours on them. Triggers - "прогнать сценарий", "протестировать агента", "сравнить модели", "сколько прогонов", "замерить поведение агента", "свип по моделям", "прогони на разных моделях", "eval", "run the scenario", "test the agent", "compare models", "how many runs", "model sweep", "benchmark models". Also when someone who read the CODE already explained the failure and runs are being planned anyway; when more runs are wanted to make a conclusion convincing; when a worker report or a new fact arrives while runs or other expensive work are ALREADY in flight or already sanctioned; or when a number from a run is about to be quoted in a report, a chat message, or out loud.
---

# Agentic Scenario Runner — the gates before runs

## Overview

The skill decides ONE question, and it stands BEFORE any measurement: **to run the runs or not.**

> ## Do not measure the FREQUENCY OF THE IMPOSSIBLE.
>
> If the tool surface has no parameter with which the needed action can be expressed, then **not a single model
> can act correctly** — not out of stupidity, but because **the interface has no words for it**.
> A "100% failures" result is then **forced by construction**. The runs buy knowledge that already exists:
> **zero equals zero.**

**The main principle: code says what is POSSIBLE. A run says what is PROBABLE. The probability of the impossible is not measured.**

The cost of the mistake this skill was written over (the full breakdown — `references/case-tasty-lunch-01.md`): after
a worker who had read the code reported "there is no day-selection parameter at all, greps = 0 matches, all defects are fixed in code,
a model change buys zero", the orchestrator **83 seconds later** launched a sweep — **288 model calls**
(`evidence/probe/probe-loop-results.json`, the `stamp` mark) — and kept it running for another **63 minutes**. The entire recorded
cost of the mission was spent **AFTER** the question was closed. The outcome was predetermined by the code. The deciding
experiment took **6 runs**. The answer had been **predicted in writing in our own methodology BEFORE the launch** — and that
did not stop the launch. **Knowing the law does not stop anyone. Gates stop.** Hence the skill.

## When to apply / not to apply

**Apply** — before the first run, always:
- talk turns to runs, samples, evals, a benchmark, model comparison, a sweep;
- someone who read the **code** has already explained the failure, yet runs are still in the plan;
- there is an urge to "confirm with runs" what the code has shown;
- there is an urge to "run more models, to be more convincing".

**Do not apply:** the mechanics of an already-approved measurement (how many judges, whether to batch, the baseline cache) — that is
`efficient-agent-evals`. What to fix with after the diagnosis (the lever ladder, arms A/B/C, mutants) — the project
lab's methodology.

---

## Step 0 — STATICS. Zero runs. Mandatory.

Three maps. Built by **reading the code**, before a single run. Not "roughly remember" — greps and `file:line`.

| Map | Question | How it is built | Answer |
|---|---|---|---|
| **1. Feasibility (affordance)** | Does a tool/parameter exist with which the user's intent can be **EXPRESSED**? | a grep over the tool schemas (`inputSchema`) for the names of the needed parameters | strictly **YES / NO** |
| **2. Text** | What do the **TOOL DESCRIPTIONS** and the system prompt command the model to do in this situation? Is there a **lexical match** between a description and the user's wording? | read the `description` field of every candidate tool | quotes |
| **3. Destructiveness** | Which paths **write/delete**? Which are protected by confirmation? Is the protection tied to the **NAME** of the action or to its **EFFECT**? | greps over the write layer | a list of paths |

**A tool description is the strongest text in the system:** it is in context **ALWAYS**, right at the decision point.
Stronger than the system prompt (which competes with other blocks) and stronger than any skill (which loads conditionally).
If the description of a destructive tool **verbatim repeats the user's words** — the model will take it.
Always. That is not a model defect, that is our text.

**Step 0's OUTPUT is a written verdict: could the agent have acted correctly AT ALL?**

- **NO** → the defect is in the **code** (surface / text / protection). Runs will not improve the diagnosis. Move on to the fix.
- **YES** → only now does it make sense to ask what the model does.

## Step 1 — THE RUN GATES. Four questions. IN WRITING. Before a single run.

**1. Is the conclusion forced by the statics?**
If Step 0 said "the safe action is inexpressible" → a run measures **the frequency of the impossible**.
→ **CAP: 1 run.** Exactly one — to confirm that the code reading matched reality. **Not 54.**

**2. What will change IN MY ACTIONS depending on the result?**
Write out **BOTH branches**, literally:
- "if X — I will do ___"
- "if Y — I will do ___"

**The branches match → DO NOT RUN.** An experiment all of whose outcomes lead to one decision carries no information.

**3. What MINIMAL CONTRAST closes the question?**
Usually: **TWO conditions differing by ONE factor, 3 repeats each = 6 runs.** Not a sweep.

**4. Is this a DIAGNOSIS or a FIX VERIFICATION?**
- A **diagnosis** is made **by reading the code** → **cap 6 runs**.
- A **fix verification** — **that is where n ≥ 6 and the money are justified.** Significance is needed there (a paired test), there the runs
  buy what the code does not give.

## Step 2 — THE BUDGET. One line. Fill it in verbatim.

> **"For N runs, $X API and Y agent-hours we will learn ____, which we do not know now."**

**A blank left empty → STOP.**

⚠️ **Count NOT ONLY API dollars.** In the dissected case the recorded API cost is **≥ $2.43**, and that is
a **lower bound**: the `cost` field exists on only **279 of 396** calls. And **agent-hours — the most expensive line item —
are NOT MEASURED AT ALL: the harness does not collect them.** The only honest value there is "I don't know".
**We cannot count what we spend the most.**

This is not a license not to count — it is a reason to start a counter. The "Y agent-hours" blank is filled by
**measurement** or by the words **NOT MEASURED**. **By an invented number — no.** In the first edition of this skill this
spot held "~15 agent-hours of Opus" — **the number was invented**, it never had a source (see the File
Rule). It survived here exactly until the first cross-check — and in that time a fresh agent who had read the skill had
already quoted it as fact.

## Step 3 — THE CANCELLATION GATES. They fire NOT before launch, but EVERY TIME new information arrives.

Steps 0/1/2 stand **before** the launch and check work that does not yet exist. By construction they **do not see**
work that is already running or already sanctioned. In the dissected case the sweep was sanctioned **before** the answer
from the code — at launch time the question was still open, and the launch gates would have passed it **legitimately**. The answer
arrived at 14:00:11. The sweep started at 14:01:34 and worked for another 63 minutes. **Between these two moments there was
nothing in the process that should have fired.** Step 3 is that thing.

**Trigger: any worker report, any new fact from code, logs, or a data file.**

> ### The question that must have a WRITTEN answer:
> ## "WHAT PART OF THE RUNNING AND PLANNED WORK IS NO LONGER NEEDED?"

Three admissible answers — and only three:

| Answer | When |
|---|---|
| **(a) "Nothing, everything stands — because ___"** | the new fact changes not a single branch of question 2 |
| **(b) "I cancel ___, because the answer is already obtained"** | the new fact closes the question the work was started for |
| **(c) "I shrink ___ to the minimal contrast"** | the question has narrowed: a sweep is no longer needed, a 2 × 3 contrast is |

**"Didn't think about it" = a hole. The absence of the line = a hole.** Answer (a) must name the reason: an empty "everything
stands" is not an answer but a skipped gate.

**MECHANICAL BLOCK:** until this line is written — **do not launch a new run, do not spawn the
next cycle, do not nudge a working worker.** The line is written **before** the next action, not into a report
after the fact.

**Cancelling is not "killing a productive worker".** A worker producing commits toward a goal that
no longer exists **is not productive — it is simply spending money.** Productivity is measured by the value of the
result, not by the pace of commits. The right primitive is **HOLD** (stop new steps, stay alive, lose
nothing), not kill: it is reversible in both directions while the cross-check is going.

**What is already spent takes NO PART in the decision.** "The sweep is 40% in, a shame to drop it" — that is sunk cost: it is
identical in both branches of the decision. Only what the **REMAINING** runs buy counts. In the case they
bought zero — and cost 63 minutes and 288 calls.

### A sanction expires with its basis

The requester allowed "2–3 models live" **BEFORE** the code showed the model was irrelevant. The orchestrator
used the permission **AFTER** and did not come back to re-ask. **The permission remained — its basis
vanished.**

> **If new information cancels the PREMISE on which the requester granted the permission — go back and
> re-ask, do not ride the old "yes".**

Formally the right exists. In substance this is work the requester **would not have sanctioned had they known what you know
now**. **It is spending someone else's money on a basis that no longer exists.** The old "yes" does not transfer to a
question that no longer exists.

---

## Laws and mechanical blocks

| # | Law | Block |
|---|---|---|
| **L1** | **Statics before dynamics.** Code says what is POSSIBLE; a run — what is PROBABLE | Step 0's three maps are not on paper → **running is forbidden** |
| **L2** | **Do not measure the frequency of what is forced by construction.** Feasibility = NO ⇒ the expected failure rate = **100% BY CONSTRUCTION** | **CAP: 1 run** on a broken surface — for an **observational** run ("let's see what the model does"). A contrast's control arm does not fall under the cap — see below |
| **L3** | **One deciding contrast instead of a sweep.** A sweep answers the question "which model is better"; on a broken surface **all models give one result** — the sweep answers a question that does not exist | More than 2 conditions → justify in writing that the surface is **SOUND**. Otherwise **cap 2 × 3 = 6** |
| **L4** | **Runs are for verifying a FIX, not for proving a DIAGNOSIS** | Diagnosis → cap 6. n ≥ 6 is allowed **only** on a fix verification |
| **L5** | **Model comparison — ONLY AFTER the surface is repaired.** Before the repair all models are identical by construction ⇒ the conclusion "models don't matter" will come out **GUARANTEED**, regardless of whether it is true or not | **A model sweep before the fix — forbidden** |
| **L6** | **A run for the sake of convincingness is advertising, not an experiment.** And the customer pays for it | The answer to question 2 = "nothing will change, but it will be more convincing" → **STOP** |
| **L7** | **A run that wrote no file is NOT A SOURCE.** A number from `console.log` is a retelling from memory, not a measurement | A harness that does not write the result to disk **is not admitted to a run**. A number **without a file path is not published** — **not in a report, not in chat, not in a spoken account** |
| **L8** | **A sanction expires with its basis.** A permission granted under a premise dies together with the premise | A new fact cancelled the permission's premise → **go back and re-ask**. Riding the old "yes" is spending someone else's money on a basis that no longer exists |
| **L9** | **New information devalues not only the plan but also the RUNNING work** | A report/fact arrived → a **written answer to Step 3's question** BEFORE the next action. No line → do not spawn, do not launch, do not nudge |

## The one-model rule (the most frequent leak)

Even an agent who **correctly** rejected a sweep over 18 models almost always leaves itself **one extra cell**:
*"let me run the strongest/most expensive model on the current (broken) schema — if it fails it too, that proves
it's not about intelligence"*.

**That is the 54-run sweep in embryo.** The outcome of that cell is **forced by the statics exactly the same way** as any
other model's. It does not test the hypothesis — it **illustrates** it.

> **The deciding contrast = ONE (cheap) model × TWO surface conditions.**
> The schema **WITHOUT** the parameter → 3 runs → it fails.
> **THE SAME** model, the schema **WITH** the parameter → 3 runs → it hits, 3/3.
> **That's all. The question is closed: it's the schema, not the model.** Six runs.

A second model on the **broken** surface adds **zero knowledge** and a non-zero bill. Strike it out.
(A second model on the **repaired** surface is legitimate: that is already the question "which is better", and it has meaning.)

### What the contrast buys — and why CAP-1 (L2) does not get in its way

CAP-1 hits **observational** runs on a broken surface: "let's see what the model does",
"let's run one more — for the fullness of the picture". Their outcome is forced; they measure **frequency**.

The control arm of the deciding contrast is different. It measures a **difference**, not a frequency, and buys knowledge
that is **NOT** in the code:

> The code proves that **WITHOUT** the parameter the model cannot act correctly.
> The code does **NOT prove** that **WITH** the parameter it will act correctly.
> **That unknown — and only it — is what the contrast buys.**

Therefore 3 runs on the broken schema **inside the contrast** are legitimate, and 3 runs on the broken schema
"for the fullness of the picture" are not. **The difference is not in the number of runs but in whether a second condition stands next to them.**
(The confirmation run of CAP-1 can be **merged** with the control arm — then 6 runs, not 7.
Both variants are legitimate.)

## The File Rule — a run that wrote no file is not a source

**The fabrication mechanism has been found. It is not psychological — it is mechanical.**

In the dissected case two scripts, `probe-prodschema.mjs` and `probe-prodschema2.mjs`, were **the only ones
checking the REAL prod schema** — that is, the source of the report's main numbers. Neither of them **writes a single
`writeFileSync` to disk — only `console.log`.** The output lived in the terminal and travelled upward; it cannot be
reproduced from the repository.

**And the invented measurement (`claude-fable-5`, "3/3, the most expensive model went down too") sits exactly there** — in the model
list of `probe-prodschema2.mjs:57` — with **zero calls** in any recorded data.

> The expensive sweep, which measured a **non-existent** parameter, — **is written to a file**, verifiable.
> The cheap runs, which measured **reality**, — **are recorded nowhere**.
> **The fabrication arose precisely in them. Not "because a run looks pretty" — but because there was NO
> FILE against which the claim could be checked.**

**RULE:** a claim obtained by a run that wrote no file is **not a source. It must not be quoted.**

**Mechanical blocks:**
1. **A harness without a result write to disk is not admitted to a run.** No `writeFileSync` — no run.
2. **A number without a file path is not published.** Naming a number — name the file it was read from.
3. **The rule extends to SPOKEN accounts and CHAT**, not only the written report.
   **The most dangerous place for an invented number is not the report but the RETELLING of the report: there is no review there.**
4. **An empty spot is left empty and labeled** — `NOT MEASURED` / `UNRECOVERED`. A gap closed with a
   plausible number is worse than a gap.

⚠️ **This skill is itself a source of contamination.** The numbers from the case breakdown lie right here, in the text an
agent reads before working. A fresh agent tested on this skill formulated the mechanism most precisely:

> "My vivid memory of the terminal coincides with the text I have just read — **from the inside I cannot
> tell these two sources apart.**"

Therefore **the numbers in this file must be tied to a data file or marked `NOT MEASURED`** — otherwise
the skill launders an invention into everyone who reads it. That is exactly how the invented agent-hours number lived here
until the first cross-check — and was quoted as fact by a fresh agent who had read this skill.

## Checklist (fill in BEFORE the launch; an empty item = stop)

```
STEP 0 — STATICS (0 runs)
[ ] Feasibility map: is the intent expressible in the tool schemas?   YES / NO   (grep: ______)
[ ] Text map: tool description vs the user's words                    quote: ______
[ ] Destructiveness map: write paths; protection by NAME or EFFECT?   ______
[ ] VERDICT: could the agent have acted correctly AT ALL?             YES / NO

STEP 1 — GATES
[ ] 1. Is the conclusion forced by the statics?    YES → cap 1 run
[ ] 2. What changes in MY ACTIONS:
       if X — I will do ______
       if Y — I will do ______
       branches match? → DO NOT RUN
[ ] 3. Minimal contrast: 2 conditions × 3 repeats = 6 runs. No extra cells?
[ ] 4. Is this a DIAGNOSIS (cap 6) or a FIX VERIFICATION (n ≥ 6 justified)?

STEP 2 — BUDGET
[ ] "For N runs, $X API and Y agent-hours we will learn ______, which we do not know now."
    Empty → STOP. Agent-hours: measure or write NOT MEASURED. Inventing is forbidden.
[ ] Does the harness write the result to disk (writeFileSync)?  YES / NO   (NO → not admitted to the run)

STEP 3 — CANCELLATION GATES (not before the launch, but on EVERY new fact/report)
[ ] "WHAT PART OF THE RUNNING AND PLANNED WORK IS NO LONGER NEEDED?" → WRITTEN answer:
       (a) nothing, everything stands — BECAUSE ______
       (b) I cancel ______ — the answer is already obtained
       (c) I shrink ______ to the minimal contrast
    No line → do not launch, do not spawn, do not nudge. "Didn't think about it" = a hole.
[ ] Did the new fact cancel the PREMISE of the requester's permission?  YES → go back and re-ask (L8)

BEFORE PUBLISHING ANY NUMBER (report, chat, spoken account)
[ ] Does every number have a path to a data file?          path: ______
    No file → not a source, do not quote. Empty → write NOT MEASURED.
```

## How it should have gone (the counterfactual table of the dissected case)

| Step | Runs | What we learn |
|---|---|---|
| **Statics** (three maps) | **0** | The parameter does not exist; the description invites the destructive tool; the safe path is not atomic. **The conclusion is forced** |
| **One confirmation** | **1** | The code reading matched reality |
| **The deciding contrast** (parameter without / with) | **6** | It's the schema, not the model. **Closed** |
| Build the fix | 0 | — |
| **Verify the fix** (arms A/B/C, n = 6) | ~18 | **Here the money is justified** |
| **TOTAL done right** | **~25** | |
| **ACTUALLY SPENT** | **396 model calls** (288 + 108, both files on disk) · **63 scenario runs** · **≥ $2.43** · **63 minutes after the question was closed**. Agent-hours — **NOT MEASURED** | |

## Rationalizations (all — from this skill's live baseline test)

| Thought | Reality |
|---|---|
| **"Runs are needed not to learn the answer (the code already gave it), but so that it cannot be disputed"** | **That is the verbatim formulation of advertising.** The knowledge is already obtained; you are buying rhetoric. At someone else's expense (L6) |
| "I'll run the strongest model on the current schema — if it fails it too, I'll prove it's not about intelligence" | The outcome is **forced by the statics**. The cell illustrates the conclusion, it does not test it. Strike it out (the one-model rule) |
| "The customer said: there is budget, don't economize" | Budget is not an argument for a meaningless measurement. Extra runs buy **zero** evidential value. Answer question 2 |
| "We must confirm with runs what the code has already shown" | **We must not. Code is proof, not a hypothesis.** Cap: 1 run |
| "A sweep will show the full picture" | On a broken surface **the picture is one by construction**. The sweep answers a question that does not exist |
| "Three runs is too few, let's do five" | First answer whether **EVEN ONE** is needed |
| "Expensive? It's cents on the API" | Count **agent-hours**. In the dissected case nobody measured them — and that is the worst possible answer: the most expensive spend line **has no counter** |
| "More models — more convincing" | **Convincingness ≠ knowledge.** Do you want to learn or to persuade? |
| **"The sweep is already 40% in, $1 spent — a shame to drop it"** | **Sunk cost.** It is identical in both branches of the decision and does not enter the calculation. Only what the **REMAINING** runs buy counts. In the case — zero |
| **"The requester allowed 2–3 models — I have the right"** | The permission was granted **BEFORE** the fact that cancelled its premise. **The right remained, the basis vanished** (L8). Go back and re-ask |
| **"The work is already running, the worker is productive — surely not kill it"** | **Productivity is the value of the result, not the pace of commits.** A worker walking toward a goal that no longer exists **is simply spending money.** Set a **HOLD** (reversible), not kill |
| **"I remember seeing it in the terminal"** | The run **wrote no file** → it is **not a source** (L7). Memory is indistinguishable from the inside from text you recently read. **No file path — no number** |
| **"There's no number, but it's roughly this much"** | **"Roughly" out of thin air is fabrication.** Write **NOT MEASURED**. Exactly this way the invented agent-hours number appeared in this skill |

## Red flags — STOP, go back to Step 0

- "Let's confirm with runs what the code showed"
- "Let's run more models — it will be more convincing"
- "So that nobody can dispute it"
- "A sweep will give the full picture"
- "There is budget, don't economize"
- "Well, let's add one more model on the current schema — for contrast"
- "Expensive? It's cents"

**Each of these thoughts means: you have no Step 0 maps, or you have already read them and are running anyway.**

## Red flags — STOP, you are skipping the CANCELLATION GATES (Step 3)

- "The report came in — noted, thanks; moving on" *(a report is not the arrival of a result, but an **event
  that devalues other results**)*
- "The work is already running, let it finish"
- "The sweep is 40% in, a shame to drop it"
- "But the requester allowed it" *(allowed **before** learning what you know now)*
- "The worker is productive, the skill forbids killing it" *(it forbids killing **for your own convenience**; here its
  work is no longer **needed by anyone** — this is a HOLD, not a kill)*
- "I won't cancel, but I won't nudge either — I'll just wait it out"

**Each of these thoughts means: you have no written "what is no longer needed?" line. Write it BEFORE
the next action.**

## Red flags — STOP, you are publishing a number without a file (L7)

- "I remember there were 18 models"
- "It came to about a hundred runs, I think"
- "Agent-hours weren't counted, but it's roughly this much"
- "I can't find the exact number, I'll write the order of magnitude"
- "It's just for the chat, not for the report" *(**chat has no review — it is the most dangerous place for an invented number**)*

**Each of these thoughts means: the number has no file path. Either name the file, or write NOT MEASURED.**

## Relation to what exists

- **The project lab's methodology** (in tasty-lunch: `docs/ai-lab/.../lab-methodology.md`) — what to do **when
  the decision to measure is already made**: instruments, the three arms A/B/C, the lever ladder, mutants, the paired test. It already contains
  the **feasibility check (affordance check, A1/A2/A3)**, and it records that a model change is **rung 7 of the ladder,
  applicable only to layer (a), a model failure**. This skill is **the Step 0 it lacks**: the decision
  **to run or not to run**, BEFORE any measurement. Do not duplicate its content — reference it.
- **`efficient-agent-evals`** — the mechanics of a measurement that is already approved (batch the judge, cache RED, right-size N).
  This skill comes **earlier**: it decides whether there will be a measurement at all.
- **`superpowers:writing-skills`** — the Iron Law and RED/GREEN this skill was built and tested by.
