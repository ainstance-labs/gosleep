# Handoff 33 — cycle 57 (impl-ui-5), GSL-98 closed

**Date:** 2026-07-13 · **Worker:** impl-ui-5 · **Model:** Opus 4.8 (verified from the transcript)
**Branch:** `GSL-90-ui-orchestration @ 33b9343` (pushed) · **Jira:** GSL-98 → Done · **GH:** #111

---

## Part 1 — what you need to know without reading the code

### What was done

Screens **Fleet** and **Cost** are closed. Fleet now renders a card per worker where **the age of the last event is the main field** (largest font, physically **above** the name). Cost got a breakdown by model and a quota-events section.

Thereby **two out of six runway clocks** (fleet slots, budget) stopped being unread. The clocks can still show `unknown` — but now because a source really is not there, not because a screen was missing.

### Four facts obtained by grep (not inherited)

1. **The worker's name is in the log.** `task.completed` is the **only** event carrying `session_id` and the worker name at once. This is the missing join: link them once and you get the whole session trail (`pane.started` → `agent.turn_ended` → `pane.ended`), and with it the age of the last event. Without this join the old screen could not answer the one question it exists to answer.

2. **The pane number is not in the log — and this was confirmed.** Grepped the whole log across all days: 0 events with a pane number, 0 pane/window/tty fields in any hook. The old docstring claimed this; the check confirmed it. The card writes `unknown` and adds that **this is fixed by a hook, not the renderer** — so the next one does not hunt for a bug in the UI.

3. **The model is taken from the session transcript**, not from the worker's word. The same source as the auditor cross-check (cycles 49/50: self-report lies). No transcript → `unknown`, **even if the worker explicitly named itself**.

4. **⚠️ The ledger and the log name the same worker differently.** In `ORCHESTRATION-STATE · TELEMETRY` he is `gsl81-reviewer`, in the log — `reviewer-lab`. Two names typed by hand in two different places and nothing cross-checks them. Join by name misses on **5 cards out of 8**. The card writes **"name miss", not "spent zero"**, and the screen prints all 48 unmatched ledger names next to it — this is a diagnosis only a human seeing both columns can make. **This is not a bug of my code; this is a process discrepancy, and it is now visible.**

### Lesson of the cycle: mutation caught a sleeping test — twice

The first mutation pass gave the "model by fact" test **`⛔ NO TEST WENT RED`**. The analysis uncovered **two different** problems:

1. **The fixture was one-sided.** The self-report leaks onto a card via **two** routes: the code can *prefer* the declaration (when a transcript exists) or *fall back* to it (when there is none). For a worker without a transcript there was no false self-report in the fixture — the second route was not covered at all. Now **both** workers lie, and a **positive control** is added: the test first proves that both lying strings **are** in the fixture — otherwise a grep-on-absence would be a green check mark over emptiness.

2. **🔥 A race with a background harness — a new class of accident.** The second pass again showed "asleep", but not the test's fault: **the edits to `smoke.sh` disappeared**. The `trap restore EXIT` of my own mutation script fired **after** I had begun editing the tree and overwrote the fixture with the backup.

   **This is the same class as `git stash` from handoff 32: a background script with a restore trap is a tree-wide writer.**
   - **Symptom:** the test counter did not grow after adding a test (229 instead of 230). If you added a test and the number did not change — the edit is not there, not the test "does not count".
   - **Rule:** do not edit files a live background process has backed up; do not consider `restore` to have happened until the process is confirmed dead (`pgrep`).

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: 57 / impl-ui-5
STATUS: COMPLETE
EPIC: GSL-90 (Phase 5 UI)
BRANCH: GSL-90-ui-orchestration
COMMIT: 33b9343
JIRA: GSL-98 → Done (verified by getJiraIssue)
GATES: smoke 230/230 (was 208) · hooks-verify 14/14 · tsc clean · chronicler 7 pages
ACCEPTANCE: all Jira description items met (see below)
MUTATION-TESTED: 10 mutations, each reddens EXACTLY its test
DECISION: q-2026-07-13-005 (C5 exemption) — default applied, reversibility high
BLOCKED_ON_HUMAN: none
MODEL: Opus 4.8 (claude-opus-4-8, verified from transcript)
```

### Acceptance (per Jira description, item by item)

| Requirement | Status |
|---|---|
| Fleet: a card per worker (state/model/pane/started/last-event-age/tokens/task) | ✅ all 7 fields |
| Age of the last event — the **main** field of the card | ✅ largest font, above the name |
| Silent and dead workers do not blur — do not pretend | ✅ 3 states, no `dead` deliberately |
| Model — by fact, from the same source as the cross-check | ✅ session transcript, not self-report |
| Cost: per-cycle | ✅ (was) |
| Cost: cumulative vs ceiling | ✅ ceiling = `unknown` (not on disk) |
| Cost: per-model | ✅ + number of unreadable lines next to each sum |
| Cost: quota events | ✅ empty, but prints its glob |
| Metrics without a source → `unknown`, runway hours → unknown (**do not lengthen**) | ✅ verified on the live render: budget `unknown`, headline "Cannot say" |

---

## Part 2 — technical part

### Schema `render/6`

Edit in 4 places at once. New in the bundle: `fleet.workers`, `fleet.unnamed_sessions`, `fleet.ledger_only`,
`cost.by_model`, `cost.quota`.

### C5 — how to read `teammate_name` without killing the check

The C5 denylist guards **capability**, not vocabulary.

**Solution** (DECISION `q-2026-07-13-005`): exclude **exactly one literal** `teammate_name`:

```bash
c5_takes_a_pane() { sed -E 's/teammate_name//g' "$1" | grep -qEi 'tmux|spawn|Agent tool|teammate'; }
```

What was **not** done and why:
- **Not** a word-boundary (`\bteammate\b`), as the brief recommended: applied to all four words it would stop catching `tmux_send` and `spawn_worker`. This is a weakening, not a refinement. My variant is **stricter** than the recommended one.
- **Not** a separate script: moving the string into a file C5 does not scan is bypassing the check, not separating it.
- **Not** `tmux list-panes`: a C5 violation in substance.

**🔑 Renamed my own field instead of excluding it.** The first card version introduced `spawned_ts` — and it broke C5. Excluding `spawn` is not allowed: this word guards a real dangerous capability. I renamed to `started_ts` by the log's own vocabulary (`pane.started`) — also more accurate: the chronicler does not create panes, it sees a pane opened.

> **Rule for future cycles: do not weaken a capability word when renaming is free.**
> Exclusion is justified only where the name is set by someone else's format and there is no alternative (`teammate_name`).

The exclusion boundary is held **by three tests in CI** (`C5-narrow`), not a comment: the key passes,
`teammate.spawned` fails, bare `teammate` fails. A check whose exclusion can silently widen is already
a dead check.

### Mutation matrix (10/10)

| Mutation | Reddens |
|---|---|
| M1 C5 exclusion widened to a whole word | `C5-narrow: exemption widened` |
| M2 C5 exclusion removed | `C5-narrow: exempt key is rejected` |
| M3 card does not render age | `card does not render the age element` |
| M4 silent worker declared dead | `silent worker was not called silent` + `claims to tell silent from dead` |
| M5a card **preferred** self-report over the transcript | `model is not the transcript's` + `self-report reached the page` |
| M5b card **fell back** to self-report | `self-report reached the page` + `model invented` |
| M6 a pane id was invented | `a pane id was invented` |
| M7 join miss rendered as zero | `unjoined worker rendered as having spent zero` |
| M8 rollup hid unreadable lines | `cycle with unreadable token field silently dropped` |
| M9 empty quota section does not print the glob | `quota section cannot say where it looked` |

### Environment variables (for offline fixtures)

- `GOSLEEP_TRANSCRIPT_DIR` — where to look for transcripts (otherwise `~/.claude/projects/<repo-slug>/`).
- `GOSLEEP_QUIET_AFTER_S` — silence threshold (default 900).
- `GOSLEEP_TOKEN_CEILING`, `GOSLEEP_SLOT_CAP` — were there before.

---

## ⭐ RESUME POINT for impl-ui-6 (GSL-99, self-health)

**Branch:** `GSL-90-ui-orchestration @ 33b9343`, pushed. Schema `render/6`.

### Mandatory reading
1. **This handoff, Part 1** — four obtained facts + both lessons (a sleeping test, a race with the harness).
2. `docs/handoff/32-...-impl-ui-4.md` — git stash lesson; `31-...` — verify "no source" by hand.
3. **Read the Jira GSL-99 description yourself** — half the acceptance lives there.
4. **And grep the code before deleting/changing what the description asks to delete** (impl-ui-4 lesson: the Jira description is a snapshot of intent, not ground truth).

### What you will need from my cycle

- **`load_events()` + join on `session_id`** — if self-health needs to understand who did what, the join is already in `fleet_workers()` (chronicler.py). Do not invent a second.
- **`session_models()`** — resolve the actual model by session_id. Ready, with an offline fixture via `GOSLEEP_TRANSCRIPT_DIR`.
- **The "print your glob" rule** — any empty section must print where it looked. For me these are `cost.quota.searched` and `fleet.workers_searched`. "Empty" and "showed the wrong thing" are otherwise indistinguishable.
- **Fixture `$WORK/f5-fleet`** in smoke.sh — a template: its own throwaway repo, its own transcripts, its own ledger.

### Open tails (NOT my bugs, but know)

- **48 ledger names do not map to cards.** Different naming conventions between epics. Fixed either by a unified convention or by an explicit field in the TELEMETRY bullet. The screen shows it — the decision is on the owner.
- **9 sessions in the log are nameless** — a worker that did not close a task through the task system does not get a card. Fixed only on the hooks/process side, not in the UI.
- **`api.failure` never fired.** Quota clock is `clear` with an asterisk. The Cost/quota section prints its glob exactly for this reason.
- **Token ceiling does not exist machine-readably** (DECISION `q-2026-07-13-002`). Budget hours = `unknown`, runway = upper bound. This is a finding, not a bug.
- **`smoke.sh` "stale temp survives"** — pre-existing flake (kill -9 race). Passed for me, but know.

### Gates that must not fall

```bash
bash tools/lab/smoke.sh          # 230/230
bash tools/lab/hooks-verify.sh   # 14/14
(cd tools/lab/ui && npx tsc --noEmit)
bash tools/lab/chronicler.sh --no-poll   # 7 pages
```

If you bump the schema to `/7` — edit in **4 places at once**: `chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`.
