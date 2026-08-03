# Handoff — gosleep — 2026-07-12 (Phase 4: the lab foundation is ready — GSL-83/84/85 landed, the night writes itself)

> For a FRESH agent. Read Part 1 (plain words) → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Complements handoff 22 (Phase 4 scaffolding),
> does not cancel its hard rules.

# ── Part 1 · Plain words ──

## 1. Where we are

The Phase 4 foundation is laid: **the night now leaves a machine trace itself**. Before, the only witness of work were commits and handoffs written by the model — that is, a trace existed exactly to the extent an agent decided to leave one. Now in parallel an event log is written that the model is not responsible for at all: Claude Code hooks pull a script, the script appends a line to `docs/lab/events/YYYY-MM-DD.jsonl`. Zero tokens. The agent can forget, lie, hang or be killed — the event is still recorded.

This is not a promise but a fact you can see with your eyes. Today's log during my work collected **10 out of 10 mechanical lines**: both of my commits (with sha), both Jira transitions to Done, all dev_history records — everything appeared by itself while I worked. Phase criterion F4-S1 ("events are written without model cooperation") is now not a declaration but **a query**:

```bash
jq -r 'select(.src|startswith("hook:")) | .type' docs/lab/events/2026-07-12.jsonl
```

## 2. What is already done

Three tasks, three commits. **GSL-83** — hooks + `lab-log.sh`: 13 hooks, the only event writer, the envelope `{ts,run_id,seq,actor,type,data,src}`. **GSL-84** — `lab-emit` learned semantic events (things the hook cannot see: a cycle started, a verdict was issued, the system decided for the owner); and the Phase 3 question queue **mirrors itself into the timeline** — without a single edit at the callers. **GSL-85** — layout, schema, retention, and write discipline that became a mechanism: append-only is held by `lab-log`, and whole files are written by the new atomic `lab-write.sh`.

## 3. What we do next

The next cycle — **impl-lab-2 on GSL-86** (chronicler) and **GSL-87** (poll-fill). The chronicler reads events and regenerates `status.json`, the digest and the indexes. The data for it is now there — before, `docs/report/` had generators without data and without triggers, and that is exactly why nothing worked.

Two tools are already prepared for it: `lab-write.sh` (it **must** write `status.json` through it — the chronicler runs under a budget limit, and death mid-write is **normal** for it) and the retention policy described in `docs/lab/README.md`, which it too must enforce (there is no cleaner yet).

## 4. Which problems there are

The main risk of the PRD ("hooks may not fire as written in the docs") **was confirmed with a margin**.
The requirement to verify by real runs, not by faith in the documentation, paid off **five times** — that many bugs no static check would have found, and each gave a silently wrong log. The two most instructive:

- A script written by the neighbor's template (`exec python3 - <<'PY'`) **gave python the heredoc as stdin** — that is, the hook payload was eaten before the program started. The hook "works", no errors, no events. Never. This is exactly the "placebo log" the PRD warned about.
- In the hook protocol **exit 2 = "block the operation"**, and a bash syntax error also gives 2.
  An unfinished `lab-log.sh` in a live session blocked every Write/Edit. Not in theory — this happened. Cured by the shim `tools/hooks/lab-log-hook.sh`, which always returns 0.

**What is left unverified — and this is honestly moved to a separate section everywhere** (in the bench report, in `docs/lab/events/README.md`, in dev_history): `StopFailure`, `PreCompact/PostCompact`, `Notification`, `TeammateIdle`, `Subagent*`, `Task*` are wired and their parsing is covered by unit tests, but **the bench cannot force them to happen** — you need a real rate-limit, a real compaction, a real teammate idle. A green check mark where nothing is proven would be a lie.

**`TeammateIdle` — the main candidate for disappointment.** The way to verify is free: after a night of fleet work simply look whether `agent.idle` appeared.

## 5. Comments and fresh decisions

- **The fork "whether to commit the raw event log" is resolved in favor of the contract: commit.** The PRD, blueprint and Phase 3 README all say one thing — everything in `docs/lab/` except `scratch/` is committed, because it is the surface the owner reads from the phone via GitHub. The risk of merge conflicts is closed by `.gitattributes` with `merge=union`.
- **A consequence the orchestrator and mechanic must know:** the live `docs/lab/events/<today>.jsonl`
  **must be "dirty" between commits** — the commit's own event is written *after* the commit.
  The handoff-22 rule "exactly one line in the tree" from now on reads as **"one line
  (`docs/prompts/2-*.md`) + a live event log"**. This is a normal state, not an error.
- `docs/prompts/2-deep-orchestrating-research.md` — still **do not commit** (owner-sovereign).
- The question queue is empty: open=0. No blockers requiring the owner.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-lab-1 #45
CYCLE_STATUS: COMPLETE
EPIC: GSL-81 (In Progress) / GH #93 — PRD Phase 4 "Laboratory (auto-doc)"
TASKS: GSL-83 (Done) · GSL-84 (Done) · GSL-85 (Done) · GSL-86..89 (To Do)
BRANCH: GSL-81-laboratory-auto-doc @ e9a1ccc — pushed
COMMITS: 3 — 2e33632 (GSL-83) · b0599db (GSL-84) · e9a1ccc (GSL-85)
GATES: smoke 60/60 (was 37/37) · hooks-verify 13/13 on a LIVE process · routing 10/10
       (4 phantoms refused) · settings.json parses · owner's Stop-guard intact · skill/ untouched
TREE: porcelain = docs/prompts/2-*.md (owner-sovereign) + live events/<today>.jsonl (normal, see · section 5)
PR: not open — by convention the mechanic will open after GSL-86..89
NEXT: impl-lab-2 — GSL-86 (chronicler) + GSL-87 (poll-fill)
BLOCKED_ON_HUMAN: none. Queue: open=0
MODEL: claude-opus-4-8 (verified from transcript, not by self-report)
TELEMETRY: tokens_out=~416k tokens_in=~0.4k cache_read=~36.3M cache_write=~706k
```

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules (carried from handoffs 21/22 — do not weaken)

1. **Every turn ends with TEXT to the owner — after ALL tool calls.** The Stop-hook will back it up, but hold the rule yourself. The pulse/wake-up is armed IN THE MIDDLE of the turn.
2. **Models: ALL agents on Opus 4.8**; the worker's model is verified **from the transcript**, self-report lies.
3. NO Workflow tool; at most **3** worker panes; kill-pane only by explicit id; **no force-push**;
   **regular merge** (never squash); idempotent creation; telemetry in STATE after a cycle;
   the orchestrator does not execute delivery itself; **workers do not touch the ledger files**.
4. tmux: our window `1:0`; sessions 0/2/3/4 — OTHER people's projects.
5. `docs/lab/decisions/manifest.md` — **owner-sovereign**, agents do not edit.
6. **NEVER `git add -A` / `git add .`** — per file only (`docs/prompts/2-*.md` do not commit).

## What appeared in the code (Phase 4, foundation)

| File | Role |
|---|---|
| `tools/lab/lab-log.sh` | **The only writer** for `events/*.jsonl`. Hook mode (stdin) + direct mode (flags). Append-only, `seq` under a lock, daily rotation, cap against runaway. Fail-open. |
| `tools/hooks/lab-log-hook.sh` | A 4-line shim — the only thing `settings.json` looks at. Always `exit 0`. **Do not delete**: without it a logger breakage blocks the fleet. |
| `tools/lab/lab-write.sh` | Atomic writer of NON-append artifacts (temp next to → fsync → rename). **Chronicler must write `status.json` through it.** |
| `tools/lab/hooks-verify.sh` | The gate: config + 10 adversarial routing cases + **a live headless run** with a real commit. |
| `tools/lab/lab-emit.sh` | + `event` (semantics) + `help`; the Phase 3 queue mirrors into the timeline. |
| `tools/lab/smoke.sh` | 60/60 (was 37/37): +13 on semantics, +10 on write discipline. |
| `.claude/settings.json` | 13 hooks. `Stop[0]` — owner's Stop-guard, **do not touch**. |
| `docs/lab/README.md`, `docs/lab/events/README.md` | Layout, three tiers, discipline, retention, **honest verification status of each hook**. |

## Gates (no CI — by hand, before every commit)

- Touched `tools/lab/` → `tools/lab/smoke.sh` (**60/60**, do not break).
- Touched hooks/`settings.json` → `tools/lab/hooks-verify.sh` (**13/13**, raises a live process).
- Edited `skill/` → `./install.sh` (in this cycle `skill/` was not touched).
- Wrote jsonl → `jq -c . docs/lab/events/*.jsonl > /dev/null`.
- Before push → `git show --stat HEAD`: exactly the intended files.

## Traps that already bit (do not step on again)

- **`exec python3 - <<'PY'` cannot be used where stdin is needed** — the heredoc IS the stdin. `lab-emit` lives with this only because it reads argv. In `lab-log.sh` there is a warning about it — do not "simplify".
- **exit 2 from a hook = "block"**, and bash syntax gives 2. Any script on a hook — behind the shim.
- **Hooks are NOT snapshotted**: the file watcher picks up `settings.json` on the fly → an edit hits the **live fleet immediately**.
- **Phantom events.** `if:` in the config matches loosely and doubles; a substring match will write `vcs.commit` on a command that only *mentions* git. Parsing goes through `shlex` with cutting out heredocs. **A lying timeline is worse than a missing one** — 4 adversarial cases in `hooks-verify` hold this.
- **Real Claude Code writes `git -C <path> commit`**, not `git commit`; **`git commit -q` prints nothing** — sha has to be asked of git. Both bugs found only by a live run.
- **Do not write into `docs/lab/` through `>`.** Only `lab-log`/`lab-emit` (append) or `lab-write` (whole).
- **A dead page must look dead** — `generated_at` + `max_event_age` on every derived artifact (this is for GSL-86).

## ⭐ RESUME POINT

**impl-lab-2 (Opus 4.8) starts with GSL-86 (chronicler), then GSL-87 (poll-fill).**

```bash
git checkout GSL-81-laboratory-auto-doc   # @ e9a1ccc, upstream configured
git log --oneline -3                      # e9a1ccc GSL-85 · b0599db GSL-84 · 2e33632 GSL-83
tools/lab/smoke.sh                        # expected 60/60
git status --porcelain                    # docs/prompts/2-*.md + live events/<today>.jsonl — both normal
```

| Key | GH | Task | Ready to start |
|---|---|---|---|
| **GSL-86** | #98 | chronicler: build scripts (`status.json`, Library index) + `claude -p` glue (budget, allowedTools) | data exists (`events/`), atomic writer exists (`lab-write.sh`), retention policy described — execute |
| GSL-87 | #99 | poll-fill reconcile (gh/jira/git → missed events) | write via `lab-log.sh --src poll-fill` (provenance already in place) |
| GSL-88 | #100 | one line `lab-emit event --type handoff.written` in `skill/handoff/SKILL.md` | type already in the vocabulary; **this is the ONLY allowed T2 edit** |
| GSL-89 | #101 | Phase 4 dev_history + `generated-at`/staleness contract | + finish: relative paths in events, `--supersedes` on `lab-log` |

**The chronicler is NOT the fourth live agent** (there are three panes, the fourth falls). Only a bounded task
`claude -p --max-budget-usd --allowedTools`. Its crash **must not** stall delivery — the data just gets stale,
and the page must show its staleness.

## Blocked on human

None. `tools/lab/lab-emit.sh list --count` → open=0.
