# Handoff — gosleep — 2026-07-12 (Phase 4 impl 5/8 done; fresh orchestrator for impl-lab-3 → mechanic → reviewer → finalizer)

> FOR A FRESH ORCHESTRATOR. Read: Part 1 → ⚠️ Hard rules → ⭐ RESUME POINT. Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (first) + this file. Supersedes handoffs 21/22/23/24. Autonomous mode by owner order — do not stop on small things.

# ── Part 1 · Plain words ──

## 1. Where we are
Phase 4 "Laboratory" (auto-doc) — **5/8 tasks landed on branch `GSL-81-laboratory-auto-doc` @ `101836c`** (pushed, PR NOT open). Ready: GSL-82 ledger + GSL-83 hooks/lab-log + GSL-84 lab-emit semantic + GSL-85 docs/lab layout + GSL-86 chronicler + GSL-87 poll-fill. 3 steps left: GSL-88 + GSL-89 (a small impl cycle) → mechanic PR → reviewer → (fixer) → finalizer merge. Jira: epic GSL-81 In Progress, GSL-82..87 Done, GSL-88..89 To Do.

## 2. What happened
The owner on 2026-07-12 ~20:35 ordered: "Another agent does spawn opus 4.8 and just works and does not keep stopping. Let's solve tasks and not stop. Switch to autonomous mode." After that — three cycles in a row without pauses: gsl81-setup (epic + 8 tasks + branch + ledger) → impl-lab-1 (GSL-83..85, hooks 13/13 live-verified on headless Claude Code 2.1.207) → impl-lab-2 (GSL-86 chronicler + GSL-87 poll-fill). Models transcript-verified: **all Opus 4.8**. The morning order "all on 4.7" is cancelled by this message; `model: opus` in Agent tool resolves to 4.8 (verified on all 4 cycles).

## 3. What we do next
Spawn **impl-lab-3** on Opus 4.8 immediately — a small cycle (GSL-88 = one line `lab-emit handoff.written` in `skill/handoff/SKILL.md` + `./install.sh`; GSL-89 = dev_history Phase 4 summary + generated-at/staleness contract doc + add `--ts` and `--supersedes` flags to `tools/lab/lab-log.sh`, so poll-fill inserts the backfill at the right point in the timeline). After — mechanic worker (opens the PR), reviewer, fixer if needed, finalizer (merge REGULAR, close #94..#101, Jira Done, delete the remote branch, `git fetch main:main` without checkout — do not touch the ledger). After Phase 4 merge — **without stopping Phase 5 UI** (owner mandate continue-at-milestone-boundaries).

## 4. Problems / known traps
- **⚠️ CRITICAL finding of cycle 46:** the PostToolUse hook in the current version of `tools/lab/lab-log.sh` **silently missed 2 commits** (heredoc inside command substitution → the parser lost `git commit`; the commit was recorded with an empty sha). **The log looked full and lied.** Both facts poll-fill restored (GSL-87). **poll-fill is the only defense; NEVER delete.** The parser was deliberately NOT fixed in the current cycle: `.claude/settings.json` is live-watched (an edit = live effect), and exit 2 = block operations (cycle 45 lesson — an unfinished script blocked every Write/Edit).
- **DECISION in the queue `q-2026-07-12-001`** (chronicler LLM-narration mode — `--narrate` under `--max-budget-usd` with an empty `--allowedTools`). **Auto-apply default (deterministic skeleton) 2026-07-13 08:00.** The owner can object in the morning via `tools/lab/lab-emit.sh answer --re q-2026-07-12-001 --answer …`. Check on the morning boundary.
- **The tree is dirty between commits — norm** (`docs/lab/events/<today>.jsonl` grows on every commit; the rule "porcelain=1 after ledger" is STALE). The mechanic/finalizer must know.
- Handoff 24 (impl-lab-2) + this handoff 25 — untracked ledger; they will go into the next ledger commit (Phase 5 setup).

## 5. Comments
- **The owner is impatient with pauses.** Autonomous mode strictly: clarifications only on a BLOCKER (denylist, credentials, irreversible). DECISION forks → typed queue record with a default + continue.
- **Explain every spawn/stop briefly** in text to the owner (why this worker, why now, why this model).
- **Answer every owner message** (even if it is irritated — do not stay silent).
- **Every turn ends with TEXT to the owner** (after all tool calls). This rule saved the project twice (2026-07-10 visibility incidents). The Stop-hook `tools/hooks/stop-require-final-text.sh` blocks silent turns.
- **Verify the worker model from the transcript**, not by self-report. Cycle 40 fixer self-reported fable-5, was opus-4-8 by jsonl. Cycle 43 finalizer verify caught 4-8 (the owner at that moment required 4.7 — that is when the `model: opus` → 4.8 trap surfaced).
- **Dogfooding events:** the auto-doc layer records itself. F4-S1 — a runnable jq query: `jq -r 'select(.src|startswith("hook:"))|.type' docs/lab/events/2026-07-12.jsonl`.

# ── Part 2 · Formal ──

## ⚠️ Hard rules (violation of the first = an immediate project stop)

1. **EVERY turn ends with TEXT to the owner — after ALL tool calls, zero tool calls after the text.** Any tool result (including `ScheduleWakeup` "Nothing more to do this turn") is NOT permission to end the turn. Two predecessors this rule did not save — it saves only by habit: the last act = text. The Stop-hook (`.claude/settings.json` → `tools/hooks/stop-require-final-text.sh`) will back it up.
2. **All agents + orchestrator = Opus 4.8** (`model: opus`, transcript-verified). Owner-approved 2026-07-12 20:35. Verify each worker's model from its jsonl (`grep '"model"' ~/.claude/projects/.../<UUID>.jsonl`).
3. **Autonomous mode:** reversible in-repo delivery without questions. DECISION forks → typed queue record with a default + continue. BLOCKED_ON_HUMAN blocks ONLY that task, not the fleet. Denylist (force-push, deletes shared, prod deploy, secrets rotation, destructive DB, external comms) → BLOCKED.
4. **NO Workflow tool.** All spawns = tmux teammates via `Agent(subagent_type:"claude", name:"...", model:"opus")`. Fleet cap 3 (the fourth falls with `fork failed: Device not configured`).
5. **REGULAR merge never squash. `git push` never `--force`.**
6. **kill-pane only by explicit id after a re-list.** Never `-a`. tmux sessions other than 11:0 (mine) are other people's projects (V4 orchestrator in 10, tasty-lunch in 5, etc — do not touch).
7. **Hook shim mandatory** for new bash hooks (`tools/hooks/lab-log-hook.sh`, exit 0 always). Bare exit 2 in a hook = "block the operation" → syntax error = exit 2 → blocks Write/Edit across the whole fleet.
8. **`.claude/settings.json` is picked up live** — an edit = live effect without a restart.
9. **Dirty tree between commits — norm** (`docs/lab/events/<today>.jsonl` grows). Ledger boundary compacts.
10. **`status.json` only via `tools/lab/lab-write.sh`** (atomic hidden-temp + rename; kill-9 survival in smoke).
11. **Ownable questions** → typed record via `tools/lab/lab-emit.sh question --type <T> --from <cycle> --task <KEY> --question "..." --default "..." --reversibility high|med`. Continue on default if type ≤ DECISION. Park only BLOCKER, only affected task.
12. **HARD GATE before a roll:** confirm EVERY worker TERMINATED. Never roll with a live worker — orphan.

## How we work (skills)
- `orchestrating-delivery-agents` (main methodology, PULSE cadence, HEARTBEAT_OK, question buffer, decision manifest, morning digest, quota auto-wait, breaker, re-wake).
- `delivery-workflow` + `using-jira` — Epic+Task, `[Tag]` summaries, key-first commits/branches, one PR per Epic REGULAR merge, GH issues mirror Jira.
- `handoff` skill — write a handoff at the session boundary, `NN-YYYY-MM-DD-...md`.
- Cycle-worker template in `~/.claude/skills/orchestrating-delivery-agents/references/worker-cycle-template.md`.

## Connections
| | |
|---|---|
| Jira project | **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, Done=41 |
| GitHub | `ainstance-labs/gosleep` (private) |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` (assign every issue) |
| Owner email | rommxx@gmail.com |
| Branch | `GSL-81-laboratory-auto-doc` @ **`101836c`** (pushed, PR NOT open) |
| Local main | @ `4af66d2` (post-GSL-72 merge) |
| Local HEAD | left on GSL-72-question-buffer (was not deleted — ledger there) — impl-lab-3 checks out the needed branch itself |
| Next Jira key | **GSL-88**, **GSL-89** (Phase 4 remaining); **GSL-90+** Phase 5 |
| Next GH issue | **#102** (Epic GSL-81=#93, Tasks GSL-82..89=#94..#101) |

## Gates
- No CI.
- `./install.sh` if `skill/` was touched (source of truth in `skill/`, sync local → global; the global copy must be identical).
- Smoke (cycle 46 baseline: 105/105 tests + hooks-verify 13/13).
- Manual verification: real-run hooks after edit; `jq . docs/lab/status.json` parseable; poll-fill idempotency (`bash tools/lab/poll-fill.sh; bash tools/lab/poll-fill.sh` → the second run 0 new lines).

## What exists in code (post-cycle 46)
Merged into main (past epics):
- Phase 1 (GSL-49) watchdog `tools/watchdog/*`, `.watchdog-*`.
- Phase 2 (GSL-65) pulse + night mode + quota-wait + breaker + HEARTBEAT_OK fast-path.
- Phase 3 (GSL-72) question buffer + decision manifest + `tools/lab/lab-emit.sh` + Stop-hook + `tools/hooks/stop-require-final-text.sh`.

On branch `GSL-81-laboratory-auto-doc` (Phase 4 in-flight):
- `tools/hooks/lab-log-hook.sh` — shim, exit 0 always (protects from block-on-error).
- `tools/lab/lab-log.sh` — 0-token event capture (append `events/<date>.jsonl` atomically), called through the shim.
- `tools/lab/lab-emit.sh` (extended) — semantic events layer over the Phase 3 queue.
- `tools/lab/lab-write.sh` — atomic writer (kill-9 survives; ONLY writer for status.json).
- `tools/lab/chronicler.sh` + `.py` — regen site/{index,timeline,library}.html + digest + status.json (0.7s pass, self-contained file://).
- `tools/lab/poll-fill.sh` + `.py` — event gap filler; runs as step 0 of chronicler; tagged `src="poll-fill"`.
- `docs/lab/README.md` — layout + retention (45 days for events, then compacted) + staleness contract.
- `docs/lab/events/README.md` — schema + provenance table + honest hook status (which fire, which lie).
- `docs/lab/events/2026-07-12.jsonl` — today's events, committed as an artifact in GSL-87 (first time on-tree).
- `docs/lab/schemas/*.md` — event schemas.
- `docs/lab/digest/2026-07-12-morning.md` — already generated by the chronicler smoke.
- `docs/dev_history/GSL-82..87-*.md` + updated README index.

Untracked ledger (waits for the next ledger commit):
- `docs/handoff/22-*.md`, `docs/handoff/23-*.md`, `docs/handoff/24-*.md`, `docs/handoff/25-*.md` (this file), plus my STATE edits, plus `docs/prompts/2-*.md` (owner-sovereign, do NOT commit).

## ⭐ Immediate next steps (RESUME POINT)

### First action: check reality
```
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_current_command}' | grep '^11:'   # my pane should be one
git rev-parse --abbrev-ref HEAD                       # locally may be GSL-72-question-buffer — not critical, impl-lab-3 checks out
git log main --oneline -1                             # 4af66d2
git ls-remote origin GSL-81-laboratory-auto-doc       # 101836c
gh pr list --state open                               # empty (PR is opened by the mechanic)
mcp__atlassian__searchJiraIssuesUsingJql project=GSL AND key in (GSL-88, GSL-89)  # both To Do
tools/lab/lab-emit.sh list                            # must show q-2026-07-12-001
```

### 1. Spawn impl-lab-3 (cycle 47, Opus 4.8)
- Cycle name: **impl-lab-3**, `subagent_type: "claude"`, `model: "opus"`.
- Two tasks — a small cycle (~15-30 min):
  - **GSL-88**: add to `skill/handoff/SKILL.md` (at the "write handoff" step) one line — a call to `tools/lab/lab-emit.sh` with the type `handoff.written` (event schema — in `docs/lab/schemas/`). After the edit: `./install.sh` from the root; verify `diff -r skill/handoff/ ~/.claude/skills/handoff/` empty.
  - **GSL-89**: (a) dev_history summary Phase 4 in `docs/dev_history/GSL-89-phase4-cycle47-staleness-contract.md`; (b) doc generated-at / staleness contract (already implemented in the chronicler, must be documented in docs/lab/README.md if not yet); (c) add `--ts <ISO>` and `--supersedes <id>` to `tools/lab/lab-log.sh` for backfill (poll-fill needs to insert exactly by the timeline).
- Commits: `GSL-88 [Skill] handoff.written event emit line + install`; `GSL-89 [Docs][Tooling] dev_history Phase 4 + staleness contract + --ts/--supersedes lab-log`.
- Handoff `docs/handoff/26-2026-07-12-handoff-impl-lab-3.md`.
- Jira: both → Done.

### 2. Spawn mechanic (cycle 48, Opus 4.8, pure mechanics)
- Verify branch pushed, all commits in place.
- `gh pr create --title "GSL-81 [Repo][Tooling] Phase 4 — Laboratory (auto-doc)" --body "$(cat <<'EOF'
Implements GSL-81.

Tasks:
- [x] GSL-82 [Docs] Ledger (#94) @ 9a056bb
- [x] GSL-83 [Tooling] hooks + lab-log.sh (#95) @ 2e33632
- [x] GSL-84 [Tooling] lab-emit semantic events (#96) @ b0599db
- [x] GSL-85 [Docs] docs/lab layout (#97) @ e9a1ccc
- [x] GSL-86 [Docs][Tooling] chronicler (#98) @ 3f52736
- [x] GSL-87 [Tooling] poll-fill (#99) @ 101836c
- [x] GSL-88 [Skill] handoff.written event line (#100) @ <SHA>
- [x] GSL-89 [Docs][Tooling] dev_history + staleness contract + --ts/--supersedes (#101) @ <SHA>

Gates: smoke 105/105 (impl-lab-2 baseline; impl-lab-3 to re-run), hooks-verify 13/13 live, status.json valid, docs/lab/events log committed as an artifact.

Mirrors GH #93.
Closes #93, #94, #95, #96, #97, #98, #99, #100, #101.
EOF
)"`
- Jira epic → In Review (21→31).
- Verify PR CLEAN (`gh pr view <N> --json mergeStateStatus` == CLEAN).
- Report ≤12 lines.

### 3. Spawn reviewer (cycle 49, Opus 4.8, off-tree review)
Reads the pushed diff off-tree (`git show <SHA>` for each commit). Checks:
- Gates green (smoke, hooks-verify).
- Cycle 45/46 rules followed (shim, live-watched settings, dirty-tree norm, status.json only via lab-write).
- The provenance table in events/README honest (which hook writes what).
- Retention implemented (chronicler cleaner works per README policy).
- poll-fill idempotency + tagging (`src="poll-fill"`).
- DECISION q-2026-07-12-001 recorded correctly.
- Stop-hook is first in the hooks chain and not broken.
- `skill/handoff/SKILL.md` changed only by GSL-88; global copy identical.

Writes `docs/reviews/REVIEW-gsl81.md` with CRITICAL/MAJOR/MINOR + verdict FIX / MERGE.
Report ≤12 lines.

### 4. If FIX → spawn fixer (cycle 50, Opus 4.8)
Applies findings + `./install.sh` if `skill/` was touched + push. Re-verify PR CLEAN.

### 5. Spawn finalizer (cycle 50 or 51, Opus 4.8, pure mechanics)
- `gh pr merge <N> --merge` (REGULAR).
- Close #94..#101 individually (`Closes` auto-closes only #93).
- Jira GSL-81 → Done (transition 41).
- `git push origin --delete GSL-81-laboratory-auto-doc`.
- `git fetch origin main:main` (FF local main, WITHOUT checkout).
- **Do not touch the local ledger** (STATE + handoffs 22/23/24/25/26 + docs/prompts/2-*.md + any untracked).
- Verify: `gh pr view <N> --json state` == MERGED; all 9 issues CLOSED; Jira Done; remote branch gone; local main advanced.

### 6. Phase 5 UI setup (cycle ~52, Opus 4.8) — WITHOUT STOPPING
Owner mandate continue-at-milestone-boundaries.
- Read PRD Phase 5 UI (`docs/prd/PRD-gosleep-evolution.md`).
- Spawn `gsl<N>-setup` — epic + tasks + branch + **ledger commit as the first task** (into the ledger go STATE + all accumulated handoffs 22..27 + updated SKILL if any + any untracked owner-approved files; **docs/prompts/2-*.md NOT to be committed**).
- Then the pipeline impl → mechanic → reviewer → (fixer) → finalizer.

## Gotchas (absorb before spawning)
1. **poll-fill = safety net; NEVER delete.** Hooks silently lie on heredoc/command-substitution mishaps (GSL-86 and GSL-82 SHAs — both falsely recorded empty in the first pass; restored by poll-fill).
2. **DECISION q-2026-07-12-001** — chronicler LLM-narration `--narrate`. Auto-apply default 2026-07-13 08:00. The owner can object in the morning.
3. **TeammateIdle DOES work** (in cycle 45 handoff 23 it was recorded as "untested/degraded" — it turned out to fire; TaskCreated/TaskCompleted too). Update expectations.
4. **events/2026-07-12.jsonl committed** in GSL-87 (first time on-tree as an artifact — proof of poll-fill's work). Future days: committed at ledger boundaries.
5. **Handoff 24 + this handoff 25 — untracked ledger** until the next ledger commit.
6. **`git status --porcelain | wc -l`** now ~15-17 (normal after cycle 46 push): docs/prompts + docs/handoff/22/23/24/25 + docs/lab/events/2026-07-12.jsonl (partially tracked, grows) + my STATE edits (untracked changes should not exist — STATE in the tree is edited). The finalizer does not touch.
7. **GSL-72 finalizer** was transcript-verified 4-8 while the "everybody on 4.7" order was in force — the work did not suffer (pure mechanics). The owner later allowed 4.8 as the norm.
8. **Handoff 21 · Hard rule 2 "ALL agents = Opus 4.8"** — was stale, then became true again. STATE Standing rules reflects the current policy.

## Blocked on human
- **q-2026-07-12-001** DECISION (chronicler --narrate); auto-apply default 2026-07-13 08:00.
- Otherwise — none.

## Telemetry (cumulative — do not reset, continue)
~76 cycles, running total ≈ **6.166M tokens**. Gaps 2a/32/35 documented in STATE. Cycle 46 added ~95k out.

## Model policy (IN FORCE)
Owner 2026-07-12 20:35: "Another agent does spawn opus 4.8 and just works and does not keep stopping. Let's solve tasks and not stop. Switch to autonomous mode." → **all agents + orchestrator = Opus 4.8**. `model: opus` in Agent tool resolves to **claude-opus-4-8** (transcript-verified in cycles 43/44/45/46 without misses). The morning 4.7 order (~14:00) is cancelled.

## Session boundary discipline
Final heartbeat before exit: `status:"rolling"` (successor expected), `open_workers:0`. Do NOT arm `ScheduleWakeup` — an armed wake-up after rolling starts the old session in parallel with the new one (two orchestrators). The final owner-visible TEXT — last. A fresh orchestrator is started manually by the owner from STATE + this file.
