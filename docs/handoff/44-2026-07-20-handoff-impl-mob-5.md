# Handoff — gosleep — 2026-07-20 (cycle 69, impl-mob-5: GSL-110 Phase 6 acceptance)

> For the orchestrator and the mechanic who will take the epic to PR. Read Part 1 → ORCHESTRATOR REPORT →
> Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + handoff 39 (Phase 6 rollout) + 40 (RC) +
> 41 (phone-readable) + 42 (design) + 43 (break-glass) + this file + handoff 35 (20 rules).
> I am the impl-worker of cycle 69. Did exactly one task: **GSL-110**, closing the phase.

# ── Part 1 · Plain words ──

## 1. What was done

**GSL-110** (Jira **Done**, verified; commit `416a1bc`). Two parts: restored the missing
dev_history for **GSL-103** and ran acceptance of Phase 6's four criteria with live runs.

## 2. Main result: 0 of 4 criteria, and the reasons are DIFFERENT

The phase landed five tasks out of seven (not counting the acceptance itself) and **did not close a
single success criterion**. The temptation to describe this as "almost ready, waiting for the
owner" is strong and wrong:

| Criterion | Verdict in fact | Evidence |
|---|---|---|
| **F6-S1** BLOCKER push to the phone | ⚠️ **NOT CLOSED**, the carrying part **REFUTED** | `rc-preflight` → `degraded`; **0 push emitters** |
| **F6-S2** `answered_by=owner` in the queue | ❌ **NOT DELIVERED** — no forward | buffer **proven by a run**; 0 such records out of 22 |
| **F6-S3** fleet event via hook→ntfy | ❌ **NOT DELIVERED** — not implemented | 13 hooks, **0** `ntfy`/`curl` |
| **F6-S4** `tmux attach` from the phone | ⏳ **NOT VERIFIED** — owner's step | `bg-preflight` → `unavailable`, 1 link of 5 |

**⏳ and ❌ are not synonyms, and here that is load-bearing.** F6-S4 **is not refuted**: the path
is written, the detector is ready, there was simply no one to run it. F6-S2/S3 are not "awaiting a
run" — there is **nothing to run**, no code. A single glyph over both states would have lied in
both directions at once: encouraged where there is emptiness, and accused where evening simply
had not yet come.

## 3. F6-S1 was refuted not by configuration but by construction — and it changes the phase plan

The criterion decomposes into three statements with different fates. The RC surface — ✅ (GSL-104
landed the wrapper and the runbook). "Approve permission from the phone" — ❌ by configuration:
`inputNeededNotifEnabled` is absent, code reads `?? !1`, preflight prints `permission prompts
will NOT reach the phone`. Off **intentionally** (`q-2026-07-20-003`), but intentionality does
not turn "off" into "on".

The main thing is the third. **A BLOCKER here is a fleet-level entity**: a worker calls
`lab-emit.sh`, a line goes into `queue.jsonl`, and **nothing further happens** — no `curl`, no
`notify`, no `ntfy` in `lab-emit.sh`; out of 13 registered hook events **none** carry
`curl`/`ntfy`. And Remote Control by design is **per-session**: it shows what happens in the
paired session, not a file written by a pane neighbor.

This is not my argument with the PRD — **it is a statement of the PRD itself**: R6.2 exists
exactly to cover "fleet-level things that per-session RC does not see", and BLOCKER questions
stand first in its load (p. 608–612). So **F6-S1 could never have been closed by task GSL-104
alone.**

The corollary worth saying aloud: **even if the owner pairs the phone tomorrow and turns both
toggles on, a worker BLOCKER at 01:00 still will not wake him.**

## 4. The phase's binding constraint is GSL-105, not "the remaining tasks"

From section 3 it follows what the status list does not show: **GSL-105 holds two of the four
criteria** — F6-S3 directly and the carrying half of F6-S1. And it is blocked by a single file
`.env.local` (verified today — still absent).

The whole residual phase hits **two owner actions**: put down the secret (opens
GSL-105 → GSL-106 → F6-S3 and F6-S1) and install Tailscale (opens F6-S4).

The good news on price: `tools/watchdog/watchdog.sh` already carries `WD_ESCALATE_HOOK` — the
seam for push is named directly in the comment as "phase-6 push / ntfy extension point". What is
missing is the secret and the hook script, not the architecture.

## 5. Three verdicts rest on absence — so each detector was verified on a fixture

Absence is the least reliable kind of evidence: the same empty output comes from a typo in a
template. Every detector was run **against a fixture where the target thing is known to exist**:

| Detector | On the fixture | On the repository |
|---|---|---|
| ntfy/curl in hooks | `True / True` | `False / False` |
| `answered_by` in the queue | `1` | `0` out of 22 |

The zeros turned out to be a property of the repository, not of the tool.

## 5a. Caught myself in the same class of error I catch task descriptions for

The first version of acceptance justified F6-S2 with "there are no fields `answered_by`/`channel`
**in the schema**": I looked at the keys of a live record, did not find them, drew the conclusion.
The conclusion is wrong.

`lab-emit.sh` **has** `answer --re q-ID --answer … --by owner --channel CH` and writes exactly
those fields — just as a **separate patch record** at the end of the file (as the PRD requires),
not by mutating the source line. I should have looked at a **closed** question, not an open one.
A hermetic run through `GOSLEEP_LAB_DIR` (live queue untouched) confirmed the target form:
`{"re":…,"status":"answered","answered_by":"owner","channel":"telegram"}`.

The verdict did not change — the criterion is about the answer **from Telegram**, not about the
form of the record. What changed is **the size of what's missing**: not "answer-path not
implemented" but "buffer ready and proven, only the forward is missing". For GSL-106 this is the
difference between "build" and "wire" — and it changes the estimate of the phase's remainder
in the better direction.

The rule "grep before believing the description" extends to your **own conclusion** too:
absence of a field in one record is not absence of the field in the system.

## 6. The `./install.sh` gate was satisfied by checking the mechanism instead of the command

The task description names `./install.sh` after edits to `skill/` the gate. The command is **under
GUARD**, bypassing is forbidden. The gate exists so the global copy reflects `skill/` — that can
be checked directly. The phase touched `skill/` exactly once: GSL-104 added a **new** skill
`skill/remote-control/SKILL.md`. `diff` with `~/.claude/skills/remote-control/SKILL.md` —
**identical**. The gate is satisfied; the alarm is off — it was not `orchestrating-delivery-agents`
that was touched, to which the directive applies, so there is simply no conflict between the
directive and the gate in this phase.

## 7. Found and closed a hole: GSL-103 lived without dev_history

Task Done, commit `40497bd` landed, the history file **did not exist at all** — not the file,
not the line in the index. Systemic cause: a ledger-task looks like a "state commit" without a
product artifact, and the feeling "nothing to document" comes naturally. It is wrong exactly the
opposite way — such tasks' content is **entirely** decisions.

The hole lived across cycles 65–68 because each worker wrote **their own** file and had no reason
to recount the set. Found only at acceptance. This is the second case of this class in the project
(the first — GSL-30, cycle 58). Therefore the ⭐ test now **counts files against the task list**,
not checks its own.

## 8. Problems

No blockers on my task. For the phase — section 4 and ⭐ RESUME.

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Task** | **GSL-110** `[Docs]` → Jira **Done** (verified by transition response), GH #124 **not closed** |
| **Commit** | **`416a1bc`** — 4 files, **+447/−0**, per-file (`git add` by list, not `-A`) |
| **Gates** | smoke **303 → 312/312** (+9, **0 removals**) · hooks-verify **14/14** · `tsc --noEmit` **0** · chronicler **FRESH**, 7 pages |
| **Mutants** | **8 ⭐, each reddens EXACTLY its own** — on a mirror in scratchpad, live tree untouched |
| **Phase acceptance** | **0 of 4**: F6-S1 ⚠️ partial / carrying part refuted · F6-S2 ❌ · F6-S3 ❌ · F6-S4 ⏳ |
| **Decisions** | no new DECISION filed; queue `open=0 (0B/0D/0C/0F) lines=22` |
| **Schema** | `render/7` untouched; `docs/lab/*` not committed (DERIVED + foreign edits) |
| **install.sh** | **untouched**, GUARD not removed; global skills untouched |
| **Model** | **`claude-opus-4-8`** — verified from the transcript found BY SESSION-ID (not by mtime) |

---

# ── Part 2 · Formal ──

## What was changed

| File | Role |
|---|---|
| `docs/dev_history/GSL-110-phase6-cycle69-acceptance.md` | **new** — phase acceptance + task dev_history |
| `docs/dev_history/GSL-103-phase6-cycle64-ledger-phase5-close.md` | **new** — closed hole, written retroactively (marked as such) |
| `docs/dev_history/README.md` | +2 index lines, +Phase 6 acceptance table |
| `tools/lab/smoke.sh` | **+9 asserts** (8 ⭐ + positive control), 0 removals |

## Tests (⭐ = has a mutant that reddens exactly it)

Acceptance is prose, and its typical way to break is not "stopped compiling" but **got softened**:
one cell of a table flipped from ❌ to ✅ on PR build, and no one in the repository notices.

| ⭐ | Mechanism | Mutant |
|---|---|---|
| F6-S2 named undelivered | no line about `F6-S2` loses `NOT DELIVERED` | → ✅ MET |
| F6-S3 named undelivered | same for `F6-S3` | → ✅ MET |
| F6-S4 marked ⏳ | the `F6-S4` line carries `NOT VERIFIED` | → ✅ MET |
| phase count is honest | line "0 of 4 closed" | → "all criteria met" |
| ⏳ and ❌ are not fused | the distinction is explained **in words** | erase the explanation |
| positive controls pinned | table with `True`/`False` | remove the table |
| GSL-105 named binding | S1↔R6.2 link in the text | strike out the link |
| every phase task has dev_history | **count of files against the task list** | remove file GSL-103 |

Plus a positive control: number of criteria lines ≥ 8, otherwise all eight would run over emptiness.

## Connections

| | |
|---|---|
| Branch | `GSL-102-mobile` @ **`416a1bc`** (+ this handoff) |
| Epic | GSL-102 = GH #116; tasks GSL-103…GSL-110 = GH #117…#124 |
| Phase 6 PR | **not yet open** |
| Jira | cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/**41=Done** |
| Queue | `open=0 (0B/0D/0C/0F) lines=22` |

## Phase 6 task status (verified, not from memory)

**Done (5):** GSL-103 · GSL-104 · GSL-108 · GSL-109 · **GSL-110**.
**In Review (1):** GSL-107.
**To Do (2):** GSL-105 (BLOCKER `.env.local`) · GSL-106 (transitively).

## ⚠️ Hard rules

All 20 handoff-35 rules in force without weakening: ⛔ tree-wide git ops · ⛔ force-push · ⛔ `--amend`
after push · ⛔ Workflow tool · ⛔ `git add -A` · fleet cap 3 · NO Story · REGULAR merge ·
`docs/lab/site/*.html` DERIVED · commit via `git commit -F` · dirty tree — norm.
**Owner directive 2026-07-20 (IN FORCE):** `./install.sh` whole not run (GUARD, exit 1 — do
not remove and do not bypass); point-`rsync -a skill/<name>/ ~/.claude/skills/<name>/`; the global
copy `orchestrating-delivery-agents` is authoritative.

## Gotchas

All prior ones in force. New from me:

- **`ntfy` exists in the repository, but no hook exists.** Grep finds the word in `watchdog.sh`
  (comment "extension point") and in the header of `bg-preflight.sh` (prose). Both are **not**
  an implementation. A naive `grep -l ntfy` gives three files and creates the impression that a
  path exists.
- **Answers in `queue.jsonl` are separate patch records, not mutations of the source line.** An
  open question's keys DO NOT include `answered_by`/`channel`; they appear as a second line on
  `lab-emit.sh answer`. Judging the schema by an open record is a direct path to a false
  conclusion (mine, section 5a).
- **`GOSLEEP_LAB_DIR` overrides the lab directory** — a hermetic queue run without touching
  the live `docs/lab/questions/queue.jsonl`. `smoke.sh` uses the same.
- **`REPO_ROOT` in `smoke.sh` is taken from the script's location** (`$SCRIPT_DIR/../..`), so
  mutants run on a **minimal mirror** in scratchpad (`tools/lab/smoke.sh` +
  `docs/dev_history/`) — no need to copy 293 MB of repository, and the live tree is not touched
  at all.
- **A positive control is mandatory for EVERY "this is not there" verdict.** Three of the four
  acceptance lines are about absence; without a fixture any of them would be indistinguishable
  from a broken template.
- **`docs/lab/*` DERIVED**: `chronicler.sh` rewrites 12 files on every gate run. Do not commit
  (predecessors 105→109 did not commit either).
- **My mutant harness produced two false "misses"** — searched a FAIL text for "distinguishes"
  and "binding constraint", while the messages say "distinction" and "dependency". The mutants
  were correct (FAIL=1 on the right line), the **checker** was wrong. Verify the expected
  fragment against the real assert text, not against a paraphrase of it.

---

## ⭐ RESUME POINT — for the mechanic who will take the epic to PR

```bash
# Orient
head -30 docs/handoff/ORCHESTRATION-STATE.md
cat docs/handoff/44-2026-07-20-handoff-impl-mob-5.md   # this file
git branch --show-current                 # GSL-102-mobile
git log --oneline -2                      # 416a1bc (GSL-110) + handoff commit
ls -la .env.local 2>/dev/null || echo "GSL-105 still blocked"
bash tools/lab/smoke.sh | tail -2         # 312/312
```

### Phase status: 6 of 8 tasks closed or in review

Remaining unclosed are **GSL-105** (BLOCKER on the secret) and **GSL-106** (transitively behind
it). Both are owner-prep, an agent does not take them.

### What to write in the PR body about the partiality — this matters more than it seems

The Phase 6 PR **cannot** be captioned with "all criteria met" or "Phase 6 complete" — that would
be exactly the softening the 8 ⭐ guards stand against, and would repeat the mistake that in
Phase 5 was specifically forbidden to the mechanic (see handoff 39, "do NOT write all criteria
met in the PR body").

Recommended wording for the PR body:

> Implements GSL-102 **partially**. Landed: GSL-103, 104, 107 (In Review), 108, 109, 110.
> **Not landed: GSL-105, GSL-106** — blocked on owner-provided `.env.local` (ntfy topic secret).
> **Phase acceptance: 0 of 4 success criteria closed** — see
> `docs/dev_history/GSL-110-phase6-cycle69-acceptance.md` for per-criterion verdicts and evidence.
> F6-S1 partially refuted (fleet-level BLOCKER has no push emitter; RC is per-session by design),
> F6-S2/F6-S3 not implemented, F6-S4 unverified (Tailscale is an owner install).

Task checklist in the PR body — all eight, with **honest** checkmarks (105/106 not checked). Epic
**stays In Progress** until 105/106 are closed; the PR can be opened (work landed and reviewed),
but the epic cannot be closed by it.

**Fork for the orchestrator.** If the owner lays down `.env.local` — priority immediately
GSL-105 (opens two criteria). If installs Tailscale — F6-S4 acceptance per runbook section 7. If
neither — the phase is mechanically exhausted, and an honest PR with partiality is its finale.

## Blocked on human

- **GSL-105 (binding constraint):** lay down `.env.local` with the ntfy topic (ACL'd/self-hosted).
  Opens F6-S3 directly and the carrying half of F6-S1. **Verified today — the file is absent.**
- **GSL-106:** after 105 (PRD: "assess after 1+2"). **Less work than it seemed**: the buffer side
  is ready and proven by a run (section 5a) — needed only a forward Telegram → `lab-emit.sh answer
  --by owner --channel telegram`, not an answer-path from scratch.
- **GSL-107 / F6-S4:** install Tailscale and **in daylight, not in an emergency**, walk through
  runbook section 7. Sign of closure — `bg-preflight.sh` with status `ready`. Currently honestly
  `unavailable`.
- **F6-S1 residual path:** verify whether a paired orchestrator raises the push
  `agentPushNotifEnabled` on a worker BLOCKER. **Neither confirmed nor refuted** — the only part
  of acceptance where I have no verdict at all.
- **GSL-109:** owner's look at the 7 screens (handoff 42), including the negative result.
- **GSL-108 / F5-S4c:** final look from a real phone (handoff 41).
- **GSL-104 / F6-S1:** hands-on pairing + decision on the second push toggle (handoff 40).
