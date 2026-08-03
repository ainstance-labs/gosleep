# Handoff — gosleep — 2026-07-13 (orchestrator roll: Phase 5 impl 6/9 Done, impl-ui-7 GSL-100 remains)

> For a FRESH orchestrator. Read Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file + `34-2026-07-13-handoff-impl-ui-6.md` (last impl handoff, contains · RESUME for impl-ui-7).
> My predecessor — me myself, cold-started this session ~13:35Z. Rolling on the boundary impl-ui-6 COMPLETE, context ~67%, roll ceiling 70%. All workers terminated, fleet empty.

# ── Part 1 · Plain words ──

## 1. Where we are

**Phase 5 UI** ("Orchestration dashboard", PRD tasks R5.1-R5.3) is in full swing. Epic **GSL-90**, branch **`GSL-90-ui-orchestration @ 8258e30`** (8 commits from main @ 5fd1de2). **6 of 9 impl tasks Done** + my orchestrator ledger commit today. Next — **GSL-100 (F5-S4 acceptance)**, not spawned yet — that is your first work.

Fleet empty (0/3). Queue clean (open=3, 0 BLOCKER — all three applied defaults). Watchdog may be on.

## 2. What was done in my shift (cold-start ~13:35Z, roll ~18:20Z)

**7 commits on branch `GSL-90-ui-orchestration` in 5 hours** (@6355aee to @8258e30):

- **GSL-95** `164bfa5` (impl-ui-2) — Questions deadline countdown F5-S2 CLOSED. Mutation-tested countdown, `clock = max(now, generated_at)` (the clock cannot go backwards).
- **GSL-96** `c965089` (impl-ui-3) — Tasks board keyed by Jira F5-S3 CLOSED. 0 broken links out of 475. Schema render/3 → /4.
- **GSL-97** `fccc720` (impl-ui-4) — Timeline+Library+client JS filter R5.2 CLOSED. 103 artifacts in Library with print-your-glob. Schema /4 → /5.
- **GSL-98** `33b9343` (impl-ui-5) — Fleet+Cost R5.1 fleet+budget axes readable. Schema /5 → /6. C5 exemption via DECISION q-2026-07-13-005 (strict — only literal `teammate_name`).
- **GSL-99** `83f49f8` + `cbdcb26` (prose fix) + `e49cf71` (handoff) (impl-ui-6) — Laboratory self-health metrics R5.3. Schema /6 → /7. Three commits — the 1-per-task rule broken honestly (force-push forbidden).
- **GSL-90** `8258e30` (orchestrator ledger) — late-commit orphaned handoffs 28+29 (impl-ui-6 self-health finding: they lay `??` in git status for 6 cycles).

**smoke progression: 130 → 174 → 182 → 192 → 208 → 230 → 248/248.** hooks-verify 14/14 always. tsc clean.

## 3. What we do next (immediately)

**GSL-100 (impl-ui-7)** — "[Docs] Phase 5 acceptance: end-check (light/dark, file:// vs GitHub) + consolidated dev_history + site/ contract". Task 6 of the PRD list, closing the epic. **Verify F5-S4 literally**: "reads from the phone through a private GitHub repo" — GitHub does not render HTML from a private repository as a page, the fact may be raw/download; record by fact, do not fit the wording. **Acceptance = EVIDENCE, not observation** (Phase 4 R4.2 lesson → PENDING).

Estimate: ~40-90 min (documentation + acceptance sweep, not complex code).

**Then without stopping** (owner mandate 2026-07-10, in memory): mechanic PR (opens GH PR, transition GSL-90 → In Review) → reviewer → (fixer if it finds CRITICAL/MAJOR) → finalizer (REGULAR merge, close issues, GSL-90 → Done, cleanup) → **Phase 6 Mobile setup** (epic after GSL-90 in the PRD).

## 4. Open problems (not blockers, but I'm passing them on)

- **2 REAL DEBTS found by impl-ui-6 self-health meters** on the live repo: (1) **GSL-30 never had a dev_history** (14 epics, 87 tasks, exactly one hole, commit 80b1e3f exists). Not Phase 5, old phase. For the owner. (2) **Handoffs 28/29 orphaned** — I closed this myself in 8258e30.
- **Ledger vs log naming gap** (impl-ui-5): 48 unmatched ledger names — `gsl81-reviewer` in TELEMETRY vs `reviewer-lab` in the log. The Fleet screen shows 5/8 misses and prints the unmatched names. Process gap, not a code bug. For the owner.
- **9 nameless sessions** — a worker that did not close through the task system does not get a Fleet card. Process gap.
- **`task.completed` stopped firing after 12:54** (impl-ui-1 close). Cycles 53-57 did not close through the task system; cycle boundary = `pane.ended`.
- **Nobody applies timer defaults** — only a live orchestrator on a pulse (impl-ui-2 finding). A night without a pulse = defaults do not fire. Not a UI task.
- **Token ceiling does not exist machine-readably** (q-2026-07-13-002 auto-resolved to status quo). BUDGET_EXCEEDED cannot fire. Runway budget hours = unknown, runway = upper bound.
- **`api.failure` hook wired but never fired** — quota clock = `clear*` with an asterisk.
- **smoke.sh:234 "stale temp survives"** — pre-existing flake (kill -9 race), before cycle 56. Do NOT fix.

## 5. Comments and lessons of this shift (important for the impl-ui-7 brief)

**Six accumulated lessons, every following worker inherits them** (baked into briefs impl-ui-2 through impl-ui-6):

1. **Read the Jira description as the FIRST TOOL** (impl-ui-2/3 lesson, twice in a row — half of acceptance was in the description, not in the brief).
2. **Grep the code to check the currency of the Jira description** (impl-ui-4 lesson): the description is a snapshot of intention at write time, not ground truth. `build_timeline`/`build_library` did not exist by the time of GSL-97, and Jira required removing them.
3. **"No source" is a claim — verify by hand, do not inherit** (impl-ui-3 lesson): impl-ui-1 recorded "no Jira→GH mapping" — it lived 2 cycles, impl-ui-3 found it via `gh issue list`. impl-ui-5 applied the same principle to C5 (found a strict exemption).
4. **⛔ NEVER tree-wide git ops in the shared tree** (impl-ui-4 incident, memory `no-git-stash-in-shared-tree.md`): `git reset --hard`, `git stash push` (inside = reset --hard), `git checkout -- .`, `git clean` — destroy others' work. For comparison → only `git worktree add /tmp/x <sha>`.
5. **⛔ Background restore-trap = tree-wide writer** (impl-ui-5 incident): the `trap restore EXIT` of a mutation script fired AFTER the tree edits began and wiped the fixture with a backup. Same class as git stash. Symptom: the test counter did not grow after adding. Rule: `pgrep` confirms the restore process is dead.
6. **🔥 Read your section's text ALOUD after green smoke** (impl-ui-6 lesson): "0s old ago" lived under 246 greens (all assert the mechanism, none read in English). **Run a prose guard test against the broken version** (`git show <parent>:<file>`) — otherwise you checked that it doesn't fall, not that it catches.

**About me:** cold-started ~13:35Z today after a roll of the previous orchestrator (impl-ui-1 read MY live heartbeat 76→78→80% = force-roll ceiling). All workers of this shift = Opus 4.8, transcript-verified (session-id path → jsonl → field `model`). The self-report model lies — verify only from the transcript (impl-ui-5 self-check 240/240, impl-ui-6 168/168).

**Stack:** shell hooks + Python data (chronicler.py = data layer) + TypeScript UI (Preact + preact-render-to-string + esbuild, SSG not SPA — `file://` does not give fetch). Stack approved by the owner. Schema now `render/7` (impl-ui-6 bumped for self_health). Bump to /8 requires an edit in 4 files at once (`chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`).

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules (do not weaken — accumulated in handoffs 21-34 + incidents 2026-07-13)

1. **Every turn ends with TEXT to the owner** after ALL tool calls. Stop-hook blocks silent turns mechanically.
2. **Models: ALL agents on Opus 4.8** (`model: opus` resolves to 4.8). Verify from the transcript (`~/.claude/projects/-Users-.../<session-id>.jsonl`, field `model`). Self-report lies.
3. **NO Workflow tool.** Fleet cap 3.
4. **AUTONOMOUS mode** (owner mandate 2026-07-12 20:35): do not stop on clarifications about small things. DECISION forks → typed queue record (`tools/lab/lab-emit.sh question`), continue. Only BLOCKER (denylist/credentials/irreversible) is parked, and only the affected task.
5. **REGULAR merge never squash. Never `git push --force`.** `gh api -X PUT` for merge (the verb "gh pr merge" in the VERBS hook would write a duplicate; see R4.2 addendum handoff 28).
6. **kill-pane only by explicit id after a re-list.** `-a` forbidden (killed live fleet 2026-07-07).
7. **⛔ NEVER tree-wide git ops** in the shared tree: reset --hard, stash push, checkout -- ., clean. For comparison → `git worktree add /tmp/x <sha>`.
8. **⛔ Background restore-trap = tree-wide writer.** `pgrep <script>` confirms the restore process is dead.
9. **Hook shim is mandatory** for new bash hooks (`tools/hooks/lab-log-hook.sh`, exit 0 always). Bare exit 2 in a hook = "block the operation" (impl-lab-1 incident 2026-07-12).
10. **`.claude/settings.json` is picked up live** — an edit = effect without a restart.
11. **`status.json` only via `tools/lab/lab-write.sh`** (atomic temp+rename).
12. **A dirty tree between commits is norm** (`events/<today>.jsonl`, `queue.jsonl`, `ORCHESTRATION-STATE.md`, `.orchestrator-heartbeat` grow). Do NOT "fix".
13. **poll-fill — a safety net, never delete**.
14. **Never `git add -A`** — per file.
15. **`docs/prompts/`, `ORCHESTRATION-STATE.md`, `docs/lab/decisions/manifest.md`** — owner/orchestrator-sovereign. Workers do not touch.
16. **C5 denylist of WORDS** (`tmux/spawn/Agent tool/teammate`), not files. The file `chronicler.py` may be touched (impl-ui-3/4/5/6 did). **impl-ui-5 explicit strict exemption**: only literal `teammate_name` allowed, 3 CI tests hold the boundary.
17. **Schema render/N — a two-sided contract.** The renderer throws on an unfamiliar schema. Bump — an edit in 4 files at once.
18. **Queue state — read FOLD (`lab-emit.sh list`), not grep** on `"status"` — the base record is always open, resolve — a separate append line (impl-ui-4 lesson).
19. **Assert MECHANISM** (id/attr/isolation), not the shadow of a string. Mutation is the only proof that an assert is alive. Each ⭐ reddens EXACTLY its own. A positive control on prose.
20. **Print your glob** for empty sections (impl-ui-4 pattern) — an empty shelf PROVES where it looked.

## Connections

| | |
|---|---|
| Jira | project **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, **Done=41** |
| GitHub | `ainstance-labs/gosleep` (private) |
| Epic GSL-90 | = **GH #103** (issue, NOT PR — GSL-90 has no PR yet; the mechanic opens it) |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` (Roman L, rommxx@gmail.com) |
| Branch | `GSL-90-ui-orchestration @ 8258e30` (pushed, tracking origin, 8 commits from main) |
| Local main | @ `5fd1de2` (= PR #102 merged, Phase 4 Laboratory) |
| Following Jira key | **GSL-102+** (GSL-101 = Phase 4 R4.2 fix closed); Phase 6 starts with GSL-102 |
| Following GH number | **#115** (after #114 = GSL-101) |

## Gates (no CI — by hand)

- `bash tools/lab/smoke.sh` — currently **248/248**. Know `smoke.sh:234` "stale temp survives" pre-existing flake (kill -9 race, before cycle 56, do not fix).
- `bash tools/lab/hooks-verify.sh` — 14/14 on a live process.
- `(cd tools/lab/ui && npx tsc --noEmit)` — clean.
- `bash tools/lab/chronicler.sh --no-poll` — 7 pages, all well-formed.
- Schema now `gosleep.lab.render/7`.

## What is in the code (short map)

- `tools/lab/chronicler.py` — data layer (Python stdlib, 0 API keys). Implements `load_events()`, `load_heartbeat()`, `fleet_workers()` with a join on `session_id`, `session_models()` for model-from-transcript, self-health meters.
- `tools/lab/chronicler.sh` — regeneration of 7 pages + status.json + morning digest.
- `tools/lab/ui/src/render.tsx` — TS/Preact SSG renderer.
- `tools/lab/ui/src/screens/` — 7 screens (overview, timeline, tasks, questions, fleet, cost, library).
- `tools/lab/ui/src/client.ts` — client JS (staleness re-grade, countdown, tickCountdowns, tickAges, FilterBar/FilterCount/initFilters pattern common).
- `tools/lab/ui/src/countdown.ts` — a common SSR+client formatter (`clock = max(now, generated_at)`).
- `tools/lab/ui/src/types.ts` — contract for the schema `gosleep.lab.render/7`.
- `tools/lab/smoke.sh` — 248 tests, mutation-friendly assertions.
- `tools/hooks/` — 13 hooks + shim.
- `tools/lab/lab-emit.sh` — semantic events + question queue helper.
- `tools/lab/lab-write.sh` — atomic status.json writer.
- `.claude/settings.json` — hooks config, Stop-hook `stop-require-final-text.sh` blocking silent turns.

## ⭐ RESUME POINT — successor orchestrator

```bash
# Cold-start orient
cat docs/handoff/ORCHESTRATION-STATE.md | head -80  # LIVE-STATUS + At a glance
cat docs/handoff/35-2026-07-13-handoff-orchestrator-roll.md  # this file
cat docs/handoff/34-2026-07-13-handoff-impl-ui-6.md  # last impl handoff, · RESUME for impl-ui-7
tail -5 docs/handoff/.orchestrator-heartbeat  # my final status:"rolling"

# Reality sanity check
tmux list-panes -a | grep '^11:'  # should be only your pane
git log main --oneline -1  # 5fd1de2
git ls-remote origin GSL-90-ui-orchestration  # 8258e30
git status --porcelain | head 10  # owner-sovereign as normal
tools/lab/lab-emit.sh list --count  # open=3 (0B/3D/0C/0F), 0 BLOCKER

# ⚠️ FIRST HEARTBEAT (ends the watchdog startup grace)
hb="docs/handoff/.orchestrator-heartbeat"
line='{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","cycle":59,"context_pct":<TWO_DIGITS>,"open_workers":0,"status":"ok","pane":"'"${TMUX_PANE}"'","note":"re-wake from handoff 35 orchestrator roll"}'
{ [ -f "$hb" ] && tail -n 199 "$hb"; printf '%s\n' "$line"; } > "$hb.tmp" && mv "$hb.tmp" "$hb"
```

**First task — spawn `impl-ui-7`** (Opus 4.8) on **GSL-100** (F5-S4 acceptance + consolidated dev_history + site/ contract).

What I have already read and passed on (in full above):
- **Jira `GSL-100` description** — three parts: end-check (light/dark, file:// vs GitHub), dev_history (per-task + Phase 5 summary), site/README.md contract (rewrite "no JS" is stale).
- **Verify F5-S4 literally**: a private GitHub repo does not render HTML as a page; fact = raw/download; record by fact.
- **Acceptance = EVIDENCE, not observation** (Phase 4 R4.2 lesson). A criterion with nothing to confirm it = ⏳ PENDING with a plan to close, not ✅ from memory.

**The impl-ui-7 brief** must contain all 6 accumulated lessons (see Part 1 · section 5 above) + known facts + rules + first actions.

**After impl-ui-7 COMPLETE:**
1. Spawn `mechanic-gsl90` (Opus 4.8) — opens the PR `GSL-90 <title>`, body `Implements GSL-90.` + Tasks checklist + `Mirrors #103.` + `Closes #103, #105..#113, #115.` (if there are still GH issues from my orchestrator ledger commit). Transition GSL-90 → In Review (31).
2. Spawn `reviewer-gsl90` (Opus 4.8) — off-tree review pinned to the SHA, 3-4 lenses, report in `docs/reviews/REVIEW-gsl90.md`. If CRITICAL/MAJOR → fixer, if FIX/MERGE → finalizer.
3. Spawn `finalizer-gsl90` (Opus 4.8) — REGULAR merge via `gh api -X PUT repos/ainstance-labs/gosleep/pulls/<N>/merge -f merge_method=merge` (do not use the verb "gh pr merge"), close remaining GH issues by hand, transition GSL-90 → Done (41), delete remote+local branch, `git fetch origin main:main` + stay on the local branch for the ledger.
4. **Phase 6 Mobile SETUP without stopping** (owner mandate 2026-07-10 continue-at-milestone-boundaries). Starts with GSL-102+, GH #115+. Read PRD · "Phase 6".

## Cumulative TELEMETRY (persistent across rolls — never reset)

- **cycles_completed ≈ 83** (from handoff 21 total ≈5464000 → now **≈8066000**, delta of my shift ≈ 2600k tokens_out across 7 impl workers)
- **Flagged gaps**: 2a/32/35/48-52/57-cache-write (see STATE TELEMETRY block detail)
- **My shift (cycles 53-58, impl-ui-1 through impl-ui-6)**:
  - cycle 53 impl-ui-1: ~461k out, 55M cache_read
  - cycle 54 impl-ui-2: 163k out, 11.8M cache_read
  - cycle 55 impl-ui-3: 245k out, 21.7M cache_read
  - cycle 56 impl-ui-4: 299k out, 29.9M cache_read
  - cycle 57 impl-ui-5: ~360k out estimate (TELEMETRY line not returned in SendMessage — gap flagged), ~40M cache_read
  - cycle 58 impl-ui-6: 292k out, 51.1M cache_read
  - Sum of my shift: ~1820k out, ~210M cache_read
- Total ≈ 8066k tokens_out through 83 cycles + gaps flagged.

## Gotchas (inherited, not weakened)

- **`chronicler.py` C5 denylist of WORDS** (`tmux/spawn/Agent tool/teammate`) — greps smoke. impl-ui-5 explicit exemption: literal `teammate_name` allowed + 3 CI tests hold the boundary. Other words forbidden.
- **Schema `gosleep.lab.render/7`** — bump in 4 files at once (`chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`).
- **`docs/lab/site/` — DERIVED**. Do not edit by hand; regenerate `chronicler.sh --no-poll`.
- **A commit via heredoc the hook does not see** — `git commit -F <file>`.
- **`ORCHESTRATION-STATE.md`** lies in `docs/handoff/` but is NOT a handoff. The `handoff.written` hook fires on it falsely. impl-ui-6 excluded by name + M2 mutation reddens.
- **`task.completed` stopped firing after 12:54** — cycle boundary = `pane.ended`.
- **Typos/duplicate worker names** between the ledger and the log (48 misses) — process gap.

## Blocked on human

**None.** Queue `open=3 (0B/3D/0C/0F)`:
- `q-2026-07-13-001` — UI framework, **default applied** (Preact + esbuild), works.
- `q-2026-07-13-004` — schema render/4 → /5 in GSL-97, **default applied**.
- `q-2026-07-13-005` — C5 exemption for literal `teammate_name`, **default applied strict**.

All reversible high, do not hold work.

**Possible questions for the owner after Phase 5 close** (I pass them, do not escalate myself — not a blocker):
- GSL-30 never had a dev_history (16 phases ago, an old hole).
- Ledger vs log naming gap (48 unmatched names — a unified convention or an explicit field).
- Nobody applies timer defaults on a night without a pulse (impl-ui-2 finding).
- Token ceiling is not machine-readable (q-2026-07-13-002 auto-resolved to status quo).

**Owner directive 2026-07-12 20:35 IN FORCE**: AUTONOMOUS MODE — do not stop on clarifications. Continue-at-milestone-boundaries on the GSL-90 → GSL-102 boundary without stopping.
