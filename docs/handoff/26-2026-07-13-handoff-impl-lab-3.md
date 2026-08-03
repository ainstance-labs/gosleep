# Handoff — gosleep — 2026-07-13 (Phase 4 IMPL closed 8/8: freshness contract, backfill in time — and a page that stopped saying "Live" over a corpse)

> For a FRESH agent. Read Part 1 (plain words) → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Complements handoff 25, does not cancel its
> hard rules. Next step — **the mechanic opens the PR**.

# ── Part 1 · Plain words ──

## 1. Where we are

**The whole Phase 4 implementation is finished: 8 of 8 tasks, all Done in Jira.** The branch
`GSL-81-laboratory-auto-doc` is pushed. The PR is **not open** — by convention the mechanic opens it, that is the next cycle.

The lab is now closed: the night writes itself (hooks, zero tokens), cross-checks against external truth (poll-fill), and every morning a single chronicler pass in 0.7 seconds redraws the dashboard, the timeline, the library and the digest — deterministic code, not a line from model memory.

## 2. What is already done

Two commits in this cycle. **GSL-88** — the handoff skill now declares itself to the timeline in one line (the hook sees a file was written but does not know *which* handoff, *about what* and *where to resume*; this line is exactly the single tier-T2 edit the PRD allows). **GSL-89** — closing the phase: freshness contract, `--ts`/`--supersedes` flags on `lab-log`, Phase 4 summary with an honest acceptance table.

## 3. What we do next

**The mechanic opens a PR for epic GSL-81** (the ready command — in handoff 25, · "2. Spawn mechanic";
substitute SHA `548fbf8` for GSL-88 and `5be2adc` for GSL-89). Then — the reviewer, if needed the fixer, the finalizer (regular merge). After merge — without stopping Phase 5 (UI).

## 4. Which problems there are

**The main discovery of the cycle: the hook records a commit that did not happen.** `PostToolUse` fires on the **command**, not on its **success** — `bash_event()` does not look at the return code. The evidence is in the log: line `seq 4` from 2026-07-12 is a `vcs.commit` with an empty `sha`, and **no commit stands behind it**. In that minute `git` holds nothing, and its message (GSL-83) was committed 2.4 minutes later by another command as `2e33632` and recorded separately (`seq 6`).

From here the rule pinned in the code and in the schema: **an empty `sha` cannot be "fixed"**. It does not mean "a commit whose sha we lost" — it may mean "there was no commit". poll-fill now explicitly refuses to bind such a line to the nearest commit: a guess would turn a phantom into an authoritative record, and an authoritative lie is the only failure this layer will not survive.

The parser itself I **did not fix**, deliberately and for the same reason as cycle 46: `.claude/settings.json` is picked up live, and an error in a hook = exit 2 = "block the operation" (in cycle 45 an unfinished script froze every Write/Edit in the fleet). **This is task #1 for the reviewer.**

Along the way **the history record is corrected**: dev_history GSL-87 reads this line as "`9a056bb` with an empty sha". Wrong — `9a056bb` the hook did not see at all (it comes only as `src="poll-fill"`, `seq` 41).

## 5. Comments and fresh decisions

- **A deviation from the task I consider mandatory.** The orchestrator wrote: GSL-89 — "a documentation task, not code, the chronicler already implements the contract". Formally yes. Actually the contract **was not held**: the freshness estimate was computed at build time and baked into static HTML. The chronicler died at 02:00, when everything was fresh — and at 07:00 the owner opens the page, and it cheerfully reports "Live — the laboratory is writing itself right now". This is literally "a stale hub hiding its staleness", the very thing the phase was started to combat (F4-S3). The cure — 20 lines of inline script: the banner re-evaluates itself on open and can **only worsen** the verdict. Documenting a contract with a hole would be worse than closing the hole.
- **`--supersedes` could not be released as is.** A reference to `seq` of a cross-day correction would strike out from the timeline **an accidental today event with the same number** — invisibly, the feed would just be shorter. Now the reference carries the coordinate `(file, seq)`; a regression test in smoke holds exactly this.
- **Automatic `--supersedes` in poll-fill — deliberately NOT done.** The only real instance of "empty sha" turned out to be a phantom, not a commit with a lost sha. It can be bound only by guessing.
- **DECISION `q-2026-07-12-001`** (chronicler: code or LLM draws the page) — default applies 2026-07-13 08:00. As of writing the queue: open=1, 0 BLOCKER. Nothing needs the owner right now.
- `docs/prompts/2-deep-orchestrating-research.md` — still **do not commit** (owner-sovereign).

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-lab-3 #47
CYCLE_STATUS: COMPLETE
EPIC: GSL-81 (In Progress) / GH #93 — PRD Phase 4 "Laboratory (auto-doc)"
TASKS: GSL-82..87 (Done) · GSL-88 (Done) · GSL-89 (Done) — 8/8, PHASE IMPL CLOSED
BRANCH: GSL-81-laboratory-auto-doc @ 5be2adc — pushed (ahead 2 from the previous push)
COMMITS: 2 — 548fbf8 (GSL-88 handoff.written) · 5be2adc (GSL-89 contract + --ts/--supersedes)
GATES: smoke 119/119 (was 105/105) · hooks-verify 13/13 on a LIVE process · status.json valid
       · install.sh: global copy of the handoff skill identical (diff -r empty)
TREE: porcelain = ledger (STATE + handoffs 22..26) + live events/digest + docs/prompts — normal
PR: NOT open — by convention the mechanic opens it
NEXT: mechanic — PR for GSL-81 (command in handoff 25 · "2. Spawn mechanic"; SHA: 548fbf8, 5be2adc)
BLOCKED_ON_HUMAN: none. Queue: open=1 (q-2026-07-12-001, DECISION, auto 08:00), 0 BLOCKER
MODEL: claude-opus-4-8 (verified from own transcript 9ea28b8d-*.jsonl, not by self-report)
TELEMETRY: tokens_out≈78k tokens_in≈2k cache_read≈11M cache_write≈500k
```

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules (carried from handoffs 21/22/23/24/25 — do not weaken)

1. **Every turn ends with TEXT to the owner — after ALL tool calls.**
2. **Models: ALL agents on Opus 4.8**; verify **from the transcript**, self-report lies.
3. NO Workflow tool; at most **3** worker panes; kill-pane only by explicit id; **no force-push**;
   **regular merge** (never squash); telemetry in STATE after a cycle; **workers do not touch
   ledger files**.
4. **Hook shim is mandatory** for new bash hooks (`tools/hooks/lab-log-hook.sh`, exit 0 always).
   Bare exit 2 in a hook = "block the operation".
5. **`.claude/settings.json` is picked up live** — an edit = live effect without a restart.
6. **`status.json` only via `tools/lab/lab-write.sh`** (atomic temp+rename).
7. **poll-fill — a safety net; NEVER delete.**
8. **NEVER `git add -A`** — per file only.
9. **Dirty tree between commits — norm** (`events/<today>.jsonl` grows on every commit).
10. `docs/lab/decisions/manifest.md` — **owner-sovereign**.

## Connections

| | |
|---|---|
| Jira project | **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, Done=41 |
| GitHub | `ainstance-labs/gosleep` (private). Epic GSL-81 = **#93**; tasks GSL-82..89 = **#94..#101** |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Branch | `GSL-81-laboratory-auto-doc` @ **`5be2adc`** (pushed, PR NOT open) |
| Local main | @ `4af66d2` |
| Next Jira key | **GSL-90+** (Phase 5 UI) · next GH issue **#102** |

## Gates (no CI — by hand)

- Touched `tools/lab/` → `tools/lab/smoke.sh` (**119/119**, do not break).
- Touched hooks / `lab-log.sh` / `settings.json` → `tools/lab/hooks-verify.sh` (**13/13**, raises a live Claude Code process). **`lab-log.sh` is the hook target: a syntax error there blocks Write/Edit
  across the whole fleet.**
- Touched `skill/` → `./install.sh`, then `diff -r skill/<name>/ ~/.claude/skills/<name>/` must be empty.
- Wrote jsonl → `jq -c . docs/lab/events/*.jsonl > /dev/null`.
- Before push → `git show --stat HEAD`: exactly the intended files.

## What appeared in the code this cycle

| File | What changed |
|---|---|
| `skill/handoff/SKILL.md` | step 5: `lab-emit event --type handoff.written` after writing the file, under guard `[ -x … ]` (the skill is global — in a repository without the lab it is a silent no-op). Installed globally. |
| `tools/lab/lab-log.sh` | `--ts <ISO>` (+ field `logged_at`) and `--supersedes <seq>\|<YYYY-MM-DD>:<seq>`; normalize offsets to UTC (py3.9 strict); malformed input — a loud error. |
| `tools/lab/chronicler.py` | `fold_superseded` understands cross-day coordinate; the "day" is counted by `ts`, not by the file name; **the banner re-evaluates freshness on open** (`STALENESS_JS`, only worsens the verdict). |
| `tools/lab/poll-fill.py` | backfill with `--ts data.occurred_at`; explicit ban on binding an empty `sha` to a commit. |
| `tools/lab/smoke.sh` | **105 → 119**. |
| `docs/lab/README.md` | the freshness contract as a **contract** (what the artifact carries, thresholds, **two different age values**, what the consumer must do). |
| `docs/lab/events/README.md` | `logged_at`, cross-day `supersedes`, honest hook status rewritten by log fact. |

## The freshness contract (signed by Phase 5)

| Grade | Age of the newest event | Env |
|---|---|---|
| `fresh` | ≤ 30 min | `GOSLEEP_FRESH_S=1800` |
| `stale` | ≤ 3 h | — |
| `dead` | > 3 h | `GOSLEEP_DEAD_S=10800` |

**There are TWO ages, not one.** `grade` judges **data** (`max_event_age_s`), not the **page**.
The consumer of `status.json` must add `now − generated_at` to `max_event_age_s` **before** trusting `grade`. Pages do this themselves on open; `status.json` has no script.

## Phase 4 acceptance status (by fact of run)

- **R4.1–R4.4 — MET.** **F4-S2 / F4-S3 / F4-S4 — MET.**
- **F4-S1 — 3 of 4.** Commit ✅ · Jira transition ✅ (including my today's GSL-88/89) · worker session ✅
  (`pane.started`/`pane.ended`) · **compaction ❌ never observed** — nothing to force it with.
- `SubagentStart` is wired but **fired zero times** (with `SubagentStop` alive) — do not expect
  `agent.spawned`; the spawn of a worker is visible as `pane.started`.

The full table with file/commit quotes — `docs/dev_history/GSL-89-phase4-cycle47-close.md`.

## ⭐ RESUME POINT

**The mechanic (next cycle) opens a PR for epic GSL-81.**

```bash
git checkout GSL-81-laboratory-auto-doc     # @ 5be2adc, pushed
git log --oneline origin/main..HEAD          # 8 commits: 9a056bb..5be2adc
gh pr list --state open                      # empty
tools/lab/smoke.sh                           # 119/119
```

The PR body — in handoff 25, · "2. Spawn mechanic". Substitute: GSL-88 → `548fbf8` (#100),
GSL-89 → `5be2adc` (#101). Then epic GSL-81 → In Review (31), verify `mergeStateStatus == CLEAN`.

## For the reviewer — three items, in decreasing importance

1. **`lab-log` parser records a commit that did not happen** (`bash_event()` ignores the return code;
   evidence — 2026-07-12 `seq` 4). Did not fix: hooks live, exit 2 blocks operations. Fix carefully,
   as a separate task.
2. **`skill/handoff/SKILL.md` changed only by GSL-88** (step 5 + a line in Quick reference); the
   global copy identical.
3. **Generated `site/*.html` + `status.json` are committed together with the generator** — same as in
   GSL-86 (`3f52736`). Live `events/*.jsonl` and `digest/` — no: they go on the ledger boundary.

## Blocked on human

None. Queue: **open=1** — `q-2026-07-12-001` (DECISION, default applies 2026-07-13 08:00).
There are no blockers requiring the owner right now.
