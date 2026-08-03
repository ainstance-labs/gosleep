# Handoff — gosleep — 2026-07-13 (cycle 50, fixer-lab: all review findings closed, PR #102 ready to merge)

> For a FRESH agent. Read Part 1 (plain words) → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Complements handoff 26 (impl-lab-3,
> closing the Phase 4 implementation) and **clarifies its · finalizer instruction**: PR #102 is merged
> **from the web interface**, not from CLI. The hard rules of handoffs 21–26 are not weakened.

# ── Part 1 · Plain words ──

## 1. Where we are

Phase 4 ("Laboratory" — the night documents itself) is **written, reviewed and fixed**. The reviewer found eight defects, one critical; all eight are closed by three commits. PR **#102 is open, green and ready to merge** — one step remains, and the finalizer must take it.

## 2. What is already done

The review issued the **FIX** verdict — and its three main findings hit the same point: **the lab must not lie about itself.**

- **The hook recorded a commit that did not happen — and signed it with a real sha.** When `git commit` failed (nothing to commit, hook rejection — fleet routine), the backup function asked git what was on HEAD now and got the **previous** commit. Into the log went a line with a valid, reachable sha under a message that matched no commit. The log is append-only: such a line cannot be removed. Now HEAD must prove it is **fresh** (made seconds ago) and **its own** (its subject matches the `-m` message of this command). Not proved — the sha is not written at all: the gap is filled by poll-fill, and the lie is not fixed by anyone.
- **The page showed a red DEAD — and a line below wrote "Live".** Re-evaluation of freshness on open rewrote the banner but left the human sentence below it baked in. Now the sentence is rewritten too.
- **The R4.2 acceptance stood ✅ on evidence that is not in the repository.** The only Phase 4 criterion phrased as a single verifiable sentence was closed by an observation preserved nowhere. Downgraded to ⏳ PENDING — closes honestly, in one real run (see · section 3).

Plus five minor: the sha parser, asserts in smoke, docs, log commit, counters.

## 3. What we do next

**The finalizer merges PR #102 — and necessarily from the GitHub web interface, not with the command `gh pr merge`.** This is not a whim: the R4.2 acceptance says "a PR merged **outside CLI** appears in the timeline". A merge from CLI would be seen by the hook — and would verify nothing. A merge from the web is seen by no one, and the event must reach the timeline **by cross-check** (poll-fill). The mechanism was written for that; it has one real run left.

After the merge: `chronicler.sh` → make sure a `vcs.pr.merged` line appeared in the log with `src="poll-fill"` and the number 102 → this is what closes R4.2. Then — close the GitHub tasks, Jira → Done, delete the branch. Then, without stopping, Phase 5 (UI).

## 4. Which problems there are

- **R4.2 stays ⏳ PENDING until the web merge.** The mechanism exists and is covered by smoke on live `gh`, but the line itself is not yet in the repository.
- **Compaction has still not been observed** — for the whole log's life there is zero `context.*` line. F4-S1 honestly stands 3 of 4; there is nothing to force it with.
- **One phantom remains in the log — deliberately.** It was left by the reviewer himself, reproducing the defect: line `seq 48` from 2026-07-13 carries sha `5be2adc` — a commit already recorded three hours earlier. Cannot be removed (append-only log), cannot be replaced (this is not a "commit with a lost sha", this is not a commit at all). Therefore in `docs/lab/events/README.md` a reading rule is recorded: for lines older than this fix the sha alone proves nothing — verify the message against the commit. New phantoms in this form will not appear again.

## 5. Comments and fresh decisions

- **The first thing the fix caught was its own test.** `hooks-verify` checked quiet-commit like this: fed the hook a message about a command **it had not run** and required a returned sha. This is literally C1's form written down as an acceptance criterion. After the fix it honestly failed (13/13 → 12/13). Now the test first makes a real commit, and a reverse one stands next to it: a failed commit does **not** get a sha. 14/14.
- **The reviewer asked for `grep -q Live` in smoke — I did it differently, and this is deliberate.** So that the script can re-evaluate prose, it must carry all three verdicts, therefore the word "Live" is now in the source of **any** page, including the dead one. A literal grep would give a red test on fixed code. Verifies the **rendered** verdict — from a span, not by grepping the file.
- **Dogfooding along the way:** my own commit `977a09e` the hook **lost** (the message went in a heredoc — a documented parser hole), and a minute later poll-fill picked it up. The safety net worked exactly as intended. The rest of the cycle's commits I made via `git commit -F` so the hook would see them.
- `docs/prompts/2-deep-orchestrating-research.md` — still **do not commit** (owner-sovereign).

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: fixer-lab #50
CYCLE_STATUS: COMPLETE
EPIC: GSL-81 (In Review) / GH #93 — PRD Phase 4 "Laboratory (auto-doc)"
TASKS: GSL-82..89 — all Done (Jira verified live). Fixes went under existing keys, no new filed.
BRANCH: GSL-81-laboratory-auto-doc @ 63b1c63 — pushed (11 commits from main: 9a056bb..63b1c63)
COMMITS: 3 — 977a09e (C1+m1+m3) · b743002 (M1+m2) · 63b1c63 (M2+m4+m5)
REVIEW: docs/reviews/REVIEW-gsl81.md — FIX (1 CRITICAL, 2 MAJOR, 5 MINOR) → closed 8/8
GATES: smoke 130/130 (was 119) · hooks-verify 14/14 on a LIVE process (was 13/13) · status.json valid
       · jsonl valid · skill/ untouched (install.sh not needed) · not a single `git add -A`
PR: #102 — OPEN / CLEAN / MERGEABLE @ 63b1c63
TREE: porcelain = ledger (STATE + handoffs 22..27 + digest + docs/prompts) + live events log — normal
NEXT: finalizer — merge #102 **from the web interface** (regular merge, not squash) → chronicler.sh →
      verify the vcs.pr.merged line (src=poll-fill, PR 102) → this closes R4.2 → close #94..#101,
      Jira → Done (41), delete remote branch, git fetch main:main
BLOCKED_ON_HUMAN: none
MODEL: claude-opus-4-8 (verified from own transcript 005323db-*.jsonl — by session-id path, not by name)
```

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules (carried from handoffs 21–26 — do not weaken)

1. **Every turn ends with TEXT to the owner — after ALL tool calls.**
2. **Models: ALL agents on Opus 4.8**; verify **from the transcript** (by session-id path), self-report lies.
3. NO Workflow tool; at most **3** worker panes; kill-pane only by explicit id; **no force-push**;
   **regular merge** (never squash); telemetry into STATE after a cycle; **workers do not touch the ledger**.
4. **Hook shim is mandatory** for new bash hooks (`tools/hooks/lab-log-hook.sh`, always exit 0).
   Bare exit 2 in a hook = "block the operation" (in cycle 45 an unfinished script froze the fleet).
5. **`.claude/settings.json` is picked up live** — an edit = effect without a restart.
6. **`status.json` only via `tools/lab/lab-write.sh`** (atomic temp+rename).
7. **poll-fill — a safety net; NEVER delete.**
8. **NEVER `git add -A`** — per file only.
9. **Dirty tree between commits — norm** (`events/<today>.jsonl` grows on every commit).
10. `docs/lab/decisions/manifest.md` — **owner-sovereign**.

## How we work

Skills: `delivery-workflow` (epic+task, one commit per task, one PR per epic) + `using-jira` + `handoff`. Hierarchy Epic+Task, a branch per epic, a dev_history per task.

## Connections

| | |
|---|---|
| Jira project | **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, **Done=41** |
| Jira statuses now | GSL-81 (Epic) — **In Review**; GSL-82..89 — **Done** |
| GitHub | `ainstance-labs/gosleep` (private). Epic GSL-81 = **#93**; tasks GSL-82..89 = **#94..#101** |
| PR | **#102** — OPEN / CLEAN / MERGEABLE @ `63b1c63` |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Branch | `GSL-81-laboratory-auto-doc` @ **`63b1c63`** (pushed) |
| Local main | @ `4af66d2` |
| Next Jira key | **GSL-90+** (Phase 5 UI) · next GH number **#103** |

## Gates (no CI — by hand)

- Touched `tools/lab/` → `tools/lab/smoke.sh` — **130/130**, do not break.
- Touched hooks / `lab-log.sh` / `settings.json` → `tools/lab/hooks-verify.sh` — **14/14**, raises a live Claude Code process. **`lab-log.sh` is the hook target: a syntax error there hits the whole fleet.**
- Touched `skill/` → `./install.sh`, then `diff -r skill/<name>/ ~/.claude/skills/<name>/` empty.
- Wrote jsonl → `jq -c . docs/lab/events/*.jsonl > /dev/null`.
- Before push → `git show --stat HEAD`: exactly the intended files.

## What appeared in the code this cycle

| File | What changed |
|---|---|
| `tools/lab/lab-log.sh` | `git_head()` — guarantees **FRESH** (`%ct` against `GOSLEEP_HEAD_MAX_AGE_S`, default 15 s) and **ITS OWN** (`%s` against the `-m` subject); `commit_subject()` parses `-m`/`-am`/`-mMSG`/`--message=`; `commit_sha()` anchors on the git-echo bracket `[<branch> <sha>]`. |
| `tools/lab/chronicler.py` | `VERDICT` — one dictionary for two renderers (page + JS); freshness prose lives in `<span id="stale-verdict">` and is rewritten inside the "only worsen" guard. |
| `tools/lab/smoke.sh` | 119 → **130** (+6 on phantom/parser, +5 on prose). |
| `tools/lab/hooks-verify.sh` | 13 → **14**: the quiet-commit test first **makes** a commit; a case "a failed commit does not get a sha" added. |
| `docs/lab/events/README.md` | The phantom described in the form it occurs (**valid** sha, not empty) + reading rule for lines older than the fix. |
| `docs/dev_history/GSL-89-phase4-cycle47-close.md` | R4.2 → ⏳ PENDING; F4-S1/R4.1 counters recomputed from the **committed** log; F4-S3 → MET-after-fix; R4.2 closing plan. |
| `docs/dev_history/GSL-87-phase4-cycle46-poll-fill.md` | Correction to R4.2 acceptance — the record is corrected, not rewritten. |
| `docs/lab/events/2026-07-{12,13}.jsonl` | Committed: now the quote arithmetic can be checked on this sha. |

Cycle details — `docs/dev_history/GSL-89-phase4-cycle50-review-fixes.md`.

## ⭐ RESUME POINT — the finalizer

```bash
git checkout GSL-81-laboratory-auto-doc     # @ 63b1c63, pushed
gh pr view 102 --json state,mergeStateStatus,mergeable   # OPEN / CLEAN / MERGEABLE
bash tools/lab/smoke.sh                     # 130/130 — before the merge
```

**Step 1 — the merge (the only step that cannot be done from CLI).**
Open https://github.com/ainstance-labs/gosleep/pull/102 and press **Merge pull request** →
**Create a merge commit** (regular merge; **never** squash — the "one commit per task" history).
`gh pr merge` **is not to be used**: the hook would see it, and R4.2 acceptance would not be verified.

**Step 2 — R4.2 acceptance (what the merge from the web is done for):**

```bash
git fetch origin main:main
bash tools/lab/chronicler.sh                                   # poll-fill runs as step zero
jq -c 'select(.type=="vcs.pr.merged")' docs/lab/events/*.jsonl # waiting for a line: src="poll-fill", pr 102
```

The line appeared → **R4.2 closed**: an event no hook saw reached the timeline through the cross-check.
Update the R4.2 status in `docs/dev_history/GSL-89-phase4-cycle47-close.md` (currently ⏳ PENDING) and pin.

**Step 3 — epic closure:** GitHub tasks #94..#101 + epic #93 → closed; Jira GSL-81 → **Done (41)**;
delete the remote branch. Then — Phase 5 (UI), first key **GSL-90**.

## Read first

- `docs/reviews/REVIEW-gsl81.md` — the review this cycle followed (evidence there too).
- `docs/dev_history/GSL-89-phase4-cycle50-review-fixes.md` — what exactly is fixed and how verified.
- `docs/dev_history/GSL-89-phase4-cycle47-close.md` · "Cycle 50 corrections" — the Phase 4 acceptance table and R4.2 instructions.
- `docs/lab/README.md` — the freshness contract (**there are two ages, not one**).
- `docs/lab/events/README.md` — provenance, phantoms, reading rule.

## Gotchas

- **`gh pr merge` for #102 — forbidden.** See above; this is not style, it is acceptance.
- **There are two ages.** `grade` judges **data** (`max_event_age_s`), not the **page**. The consumer of `status.json` must add `now − generated_at` **before** trusting `grade`. Pages do this themselves on open; `status.json` has no script.
- **A commit with a message via heredoc the hook does not see** (unbalanced quotes → the parser is silent). Use `git commit -F <file>` if you want the commit to make it into the log mechanically.
- **Count quote counters from the index** (`git show :path`), not the working tree: the hook appends a line to the log during the commit itself, so the committed file is always a prefix of the live one.

## Blocked on human

None. Question queue: `tools/lab/lab-emit.sh list --count` — 0 BLOCKER.
