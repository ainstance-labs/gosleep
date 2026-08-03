# Handoff — gosleep — 2026-07-12 (Phase 4: the lab got a chronicler — and immediately caught the timeline lying)

> For a FRESH agent. Read Part 1 (plain words) → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Complements handoff 23, does not cancel its
> hard rules.

# ── Part 1 · Plain words ──

## 1. Where we are

Phase 4 has closed into a working loop. The previous cycle taught the night to **leave** a mechanical trace; this one taught it to **present itself** to a human and **cross-check with reality**.

Now one command — `tools/lab/chronicler.sh` — in 0.7 seconds regenerates everything the owner opens in the morning: `status.json` (a machine snapshot), three pages `docs/lab/site/` (dashboard, timeline, library — self-contained HTML, opens from `file://` on a plane) and a morning digest by a canonical template. **Not a single line comes from model memory**: commits — from `git log`, "PR #92 merged" — from `gh`, Jira transitions — from the event log, cost — from the TELEMETRY line, plan — from LIVE-STATUS.

The key property for which all of this was written: **a dead page looks dead**. Every artifact carries `generated_at` and the age of the last event and attests itself — `fresh` / `stale` / `dead`. I killed the chronicler with `kill -9` five times mid-pass: `status.json` every time remained valid. A chronicler crash does not drop the delivery — the data just gets stale, and the page **says so**.

## 2. What is already done

Two tasks, two commits. **GSL-86** — the chronicler. **GSL-87** — poll-fill: cross-check of `git` / `gh` / Jira with the log and writing gaps in retroactively (`src="poll-fill"`, so the output never passes itself off as observation).

## 3. What we do next

**impl-lab-3 starts with GSL-88** (one line `lab-emit event --type handoff.written` in
`skill/handoff/SKILL.md` — this is the ONE allowed T2-tier edit) and **GSL-89** (Phase 4 dev_history + generated-at/staleness contract — the contract is already implemented and described, all that is left is to document it). Then — the mechanic: a PR on epic GSL-81.

## 4. Which problems there are

**The main discovery of the cycle: the timeline was already lying, and I caught it with my own commit.** The `PostToolUse` hook **did not see the GSL-86 commit** (`3f52736`): the message went in a heredoc inside a command substitution, and the parser lost `git commit` inside it. One more commit was recorded with an **empty sha**. This is worse than a missing hook: the log *looks* complete. Both facts were restored by poll-fill — a task written "just in case" turned out to be a repair of already working lies.

Hence a free health indicator of the T1 tier that did not exist before:

```bash
jq -r 'select(.src=="poll-fill") | .type' docs/lab/events/*.jsonl   # what the hooks MISSED
```

**A growing share of `poll-fill` = a rotting hook.**

**Good news that cancels the previous caution:** `TeammateIdle` **fires** (exactly as `events/README.md` predicted: "just look after a night of fleet work"). `TaskCreated` / `TaskCompleted` — too. The "honest status" section in `docs/lab/events/README.md` is updated in both directions: what is proven is admitted, what is lost is recorded.

**What I deliberately did NOT do:** did not fix the `lab-log` parser (GSL-83). `.claude/settings.json` is live-watched, and an error in a hook = exit 2 = "block the operation" — exactly how in cycle 45 a broken script froze every Write/Edit in a live session. Editing the parser on a live fleet is work for a reviewer or a separate task, not a drive-by fix.

## 5. Comments and fresh decisions

- **The "who draws the page — code or LLM" fork is resolved in favor of code.** The GSL-86 description in Jira gave `claude -p` generation for both HTML and the digest. I did not do it: if the LLM draws the page, then its crash, exhausted budget or timeout = **no page**, and the F4-S3 criterion falls on the first bad night. The skeleton is deterministic; `claude -p` — an optional (`--narrate`) prose insert under `--max-budget-usd` and with **empty** `--allowedTools`. Recorded in the queue as **q-2026-07-12-001** (DECISION, default = my choice, auto-apply 2026-07-13 08:00). The owner can object in the morning.
- **No open blockers.** Queue: open=1 (that DECISION), 0 BLOCKER.
- `docs/prompts/2-deep-orchestrating-research.md` — still **do not commit** (owner-sovereign).

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-lab-2 #46
CYCLE_STATUS: COMPLETE
EPIC: GSL-81 (In Progress) / GH #93 — PRD Phase 4 "Laboratory (auto-doc)"
TASKS: GSL-83/84/85 (Done) · GSL-86 (Done) · GSL-87 (Done) · GSL-88..89 (To Do)
BRANCH: GSL-81-laboratory-auto-doc @ 101836c — pushed
COMMITS: 2 — 3f52736 (GSL-86 chronicler) · 101836c (GSL-87 poll-fill)
GATES: smoke 105/105 (was 60/60) · hooks-verify 13/13 · status.json valid · kill -9 ×5 without torn write
       · R4.2 acceptance proven on the live PR #92 · poll-fill idempotency = 0 new lines
TREE: porcelain = docs/prompts/2-*.md + handoff 22/23/24 + STATE + live events/<today>.jsonl (normal)
PR: not open — by convention the mechanic will open after GSL-88..89
NEXT: impl-lab-3 — GSL-88 (skill handoff.written) + GSL-89 (dev_history + generated-at/staleness)
BLOCKED_ON_HUMAN: none. Queue: open=1 (q-2026-07-12-001, DECISION, auto 2026-07-13 08:00), 0 BLOCKER
MODEL: claude-opus-4-8 (verified from transcript 993e2c34-*.jsonl, not by self-report)
TELEMETRY: tokens_out≈95k tokens_in≈1k cache_read≈14M cache_write≈600k
```

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules (carried from handoffs 21/22/23 — do not weaken)

1. **Every turn ends with TEXT to the owner — after ALL tool calls.**
2. **Models: ALL agents on Opus 4.8**; verify **from the transcript**, self-report lies.
3. NO Workflow tool; at most **3** worker panes; kill-pane only by explicit id; **no force-push**;
   **regular merge** (never squash); telemetry in STATE after a cycle; **workers do not touch
   ledger files**.
4. `docs/lab/decisions/manifest.md` — **owner-sovereign**.
5. **NEVER `git add -A`** — per file only.

## What appeared in the code (Phase 4, tier T3)

| File | Role |
|---|---|
| `tools/lab/chronicler.sh` + `.py` | **The chronicler.** One pass → `status.json`, `site/{index,timeline,library}.html`, `site/README.md`, digest. Bounded job, NOT a pane (C5). `--narrate` = optional `claude -p` insert (bounded, toolless). `--dry-run`, `--repo`, `--date`, `--no-poll`, retention. |
| `tools/lab/poll-fill.sh` + `.py` | **Cross-check.** `git`/`gh`/Jira → gaps in the log. Idempotent (key = external identity of a fact). Step 0 of every chronicler pass. |
| `docs/lab/status.json` | Machine snapshot. **Only via `lab-write.sh`** — a torn write here is catastrophic. |
| `docs/lab/site/` | Derived pages. **Nobody edits by hand** — the next pass will overwrite. |
| `docs/lab/events/README.md` | Provenance table + **honest hook status** (what is proven, what is silent, **what loses commits**). |
| `tools/lab/smoke.sh` | **105/105** (was 60/60): +28 chronicler, +17 poll-fill. |

## Staleness contract (applies to ALL derived artifacts, including future Phase 5s)

| Grade | Age of the last event | Env |
|---|---|---|
| `fresh` | ≤ 30 min | `GOSLEEP_FRESH_S=1800` |
| `stale` | ≤ 3 h | — |
| `dead` | > 3 h | `GOSLEEP_DEAD_S=10800` |

## Gates (no CI — by hand, before every commit)

- Touched `tools/lab/` → `tools/lab/smoke.sh` (**105/105**, do not break).
- Touched hooks/`settings.json` → `tools/lab/hooks-verify.sh` (**13/13**, raises a live process).
- Wrote jsonl → `jq -c . docs/lab/events/*.jsonl > /dev/null`.
- Before push → `git show --stat HEAD`: exactly the intended files.

## Traps that bit in THIS cycle (do not step on again)

- **bash 3.2 (default on macOS) is not heredoc-aware inside `$( )`**: it counts backticks and quotes INSIDE a quoted heredoc. 33 backticks (odd) → `unexpected EOF while looking for matching '` '`.
  Cure — not "balance the quotes" but **move the program into a separate `.py`**. A bash syntax error = exit 2 = "block the operation" in the hook protocol.
- **Empty data masks a bug.** `lab-emit list --json` prints **JSONL**, and an empty queue — nothing at all. Naive `json.loads()` passed all tests and crashed on the **first real question**. Now smoke has a case with a non-empty queue.
- **One field cannot mean two things.** `--repo` in poll-fill meant both "where the lab is" and "which repo to cross-check" — and `gh` (which does not work outside a git worktree) silently drifted into `skipped`. Split into `--repo` and `--git-repo`.
- **The backfill `ts` is "when we learned", not "when it happened"** (`lab-log` does not accept `--ts`). The real time is in `data.occurred_at`. The first pass wanted to record 72 weekly commits into today's timeline; introduced a **floor** (floor = the time of the first log line), and the discarded is **counted aloud** (`prehistory_skipped`).

## ⭐ RESUME POINT

**impl-lab-3 (Opus 4.8) starts with GSL-88, then GSL-89.**

```bash
git checkout GSL-81-laboratory-auto-doc   # @ 101836c, pushed
tools/lab/smoke.sh                        # expected 105/105
tools/lab/chronicler.sh --dry-run --json  # chronicler is alive; will show staleness and gaps
git status --porcelain                    # prompts/2-* + handoffs + STATE + live events — normal
```

| Key | GH | Task | Ready to start |
|---|---|---|---|
| **GSL-88** | #100 | one line `lab-emit event --type handoff.written` in `skill/handoff/SKILL.md` | type in the vocabulary; **the ONLY allowed T2 edit**. After the edit — `./install.sh`. |
| GSL-89 | #101 | Phase 4 dev_history + `generated-at`/staleness contract | contract **already implemented** (table above) — need to document. Candidates also: `--ts` on `lab-log` (so the backfill sits in its own place in the timeline) and `--supersedes`. |

**Separately for the reviewer (not a blocker, but important):** the `git commit` parser in `tools/lab/lab-log.sh`
**loses commits with a heredoc message** and sometimes writes an empty `sha`. Compensated by poll-fill,
but not fixed. Fix carefully: hooks are live.

## Blocked on human

None. Queue: **open=1** — `q-2026-07-12-001` (DECISION, "chronicler: code or LLM draws the page",
default applies 2026-07-13 08:00). No blockers requiring the owner right now.
