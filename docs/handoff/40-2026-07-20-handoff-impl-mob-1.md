# Handoff — gosleep — 2026-07-20 (cycle 65, impl-mob-1: GSL-104 Remote Control closed)

> For the orchestrator and the next Phase 6 impl-worker. Read Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + handoff 39 (Phase 6 rollout) + this file +
> handoff 35 (20 rules and 6 lessons — all in force).
> I am the impl-worker of cycle 65. Did exactly one task: **GSL-104**.

# ── Part 1 · Plain words ──

## 1. What was done

**GSL-104 closed** (Jira **Done**, commit `eebc33e`, pushed). A thin wrapper over Remote Control
was built, an owner pairing runbook written, and — most importantly — **the actual surface was
established by hand**, not quoted.

## 2. Both written sources turned out to be inaccurate, and in different directions

This is the main result of the cycle, and it is worth reading in full.

The PRD (2026-07-08) named `claude remote-control`, `--rc` and `/rc`. The setup worker of cycle 64
looked at `claude --help`, found none of those there, saw the flag `--remote-control` and wrote
down in the task description the conclusion: **"PRD is stale, the actual flag is
`--remote-control`"**.

The conclusion would be correct if `--help` showed everything. It does not. In the CLI binary
2.1.215:

```
.command("remote-control", {hidden:!0}).alias("rc")
```

The subcommand **exists** — just marked `hidden`. `claude remote-control --help` responds
normally and shows a whole server mode: `--spawn same-dir|worktree|session`, `--capacity` (default
**32** — exactly the number the research named), `--session-id`, `--permission-mode`. The slash
command `/rc` is also real (alias `/remote-control`, toggle connect/disconnect).

Score by the PRD's three names: `claude remote-control` — correct, `/rc` — correct, `--rc` —
incorrect (it is a subcommand alias, not a flag). **The PRD was wrong on one name out of three;
the correction, fixing it, canceled two correct ones.**

> A lesson worth writing into briefs alongside the other six: **refuting a source from one
> `--help` means replacing one unverified certainty with another.** "I checked" also needs a
> check, and a cheap way to check exists (a grep over the binary took a minute).

## 3. A practical consequence not in any source

The three surfaces are not interchangeable:

| Path | What it reaches |
|---|---|
| `/rc [name]` — a slash in the session | **the session you are already in** |
| `claude --remote-control [name]` | a new session, paired at startup |
| `claude remote-control` (hidden, alias `rc`) | a many-session server |

**Flags act at process start time.** So a live orchestrator that has accumulated fleet state for
hours pairs **only** via `/rc`. If the wrapper followed the task description (where only the flag
is named), the only way to give the owner the phone would be a **restart of the orchestrator** —
exchanging all live context for a phone link. This is a trap, and it is now named directly in
the skill.

## 4. A toggle that was not there — and why I did not turn it on

F6-S1 acceptance requires **both** push toggles ON. In fact on the machine:

- `agentPushNotifEnabled` ("Push when Claude decides") = `true` ✅
- `inputNeededNotifEnabled` ("Push when actions required") — **the key is missing**

Both are read in the binary as `?? !1`: **absence of the key means "off", not "on"**. What is off
is exactly the one that carries all the nightly value — it turns a blocked permission prompt into
a phone buzz. Without it a session can stand blocked until morning, and the phone will be silent.

I did not turn it on **deliberately** (decision `q-2026-07-20-003`, default applied).
`~/.claude/settings.json` sits **outside the repository** and is picked up by live sessions
immediately: turning it on means a push from **every** permission prompt of **every** session of
the currently running fleet. At night this is not a safety net but an alarm ringing dozens of
times. Left to the owner a one-liner in runbook section 3 — turns it on knowing the price.

Separately worth knowing: the "Push when actions required" line is **additionally gated by a
server flag** `tengu_kairos_input_needed_push`. With the gate off, `/config` simply will not have
it — **absence of the line ≠ absence of the feature**, and entry is then only through the
settings file.

## 5. Why the wrapper does not pair

Pairing is a QR scan between a terminal and the phone of a live person. There is no headless
path. A script pretending to be able to pair for the owner would be theater, and its green check
mark a lie exactly where it is being relied on. Therefore `rc-preflight.sh` answers the machine
part (surface, both toggles, presence suppression), gives `ready`/`degraded`/`unavailable` and
**names the human step it cannot take**. It currently honestly says `degraded`.

## 6. Where I caught myself in a shadow of a string

The first pass of tests failed — and failed correctly. Two checks ("does not call a model", "does
not spawn a session") fired on the **script's own comment** (`# 0-LLM (C1): no claude -p`) and on
a string the script **prints**. That is, they checked the presence of a word in a file, not the
fact that the file **executes** — exactly the forbidden pattern. Rewrote to quote-aware comment
stripping + dropping printing functions, with a positive control that the stripper did not eat
the calls themselves (otherwise both checks would pass over an empty file).

## 7. Problems

No blockers on my task. **For the next worker there is a blocker — see ⭐ RESUME · GSL-105.**

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Task** | **GSL-104** `[Skill][Docs]` Remote Control → Jira **Done** (verified by `getJiraIssue`), GH #118 **not closed** (epic finalizer) |
| **Commit** | **`eebc33e`** — 6 files, +698 lines, per-file, pushed to `GSL-102-mobile` |
| **Gates** | smoke **276/276** (base 264 + 12) · hooks-verify **14/14** · `tsc --noEmit` **0** · chronicler **FRESH**, 617 events |
| **Mutations** | 6 run, **each ⭐ test reddens its mutant**; tree restored clean (`git status tools/` empty) |
| **Decisions** | `q-2026-07-20-003` — do not touch the owner's global settings automatically (default applied) |
| **Schema** | `render/7` **untouched** |
| **install.sh** | **whole NOT run** — it installs all subfolders and would have overwritten `orchestrating-delivery-agents` against the owner's directive; only `skill/remote-control` installed by the same rsync pattern (the other 135 global skills untouched) |
| **Acceptance F6-S1** | ✅ surface / swappability / limits · ⏳ **one toggle out of two** · ⏳ **push to the phone requires the owner** · ❌ **LEAD under RC not verified hands-on** |

---

# ── Part 2 · Formal ──

## What was added

| File | Role |
|---|---|
| `tools/rc/rc-preflight.sh` | **the only place in executable code** that knows the RC surface (`SURFACE` block); verdict + `--json`; 0-LLM; does not pair |
| `skill/remote-control/SKILL.md` | three surfaces and when to use which, both toggles, limits, honest degradation |
| `docs/runbooks/remote-control.md` | pairing runbook (RU) + section 6 "what exactly was verified by hand" |
| `tools/lab/smoke.sh` | +12 checks (264 → **276**) |
| `docs/dev_history/GSL-104-phase6-cycle65-remote-control.md` | dev history |
| `docs/dev_history/README.md` | index: new section `Epic GSL-102 — Mobile (PRD Phase 6)` |

## Tests (⭐ = has a mutant that reddens exactly it)

| Check | Mechanism | Mutant |
|---|---|---|
| ⭐ absent = OFF | settings without the key → `absent`, `status != ready` | `true\|absent) good` → red, **only it** |
| ⭐ false = OFF | explicit `false` does not give `ready` | `true\|false) good` → red, **only it** |
| ⭐ verdict distinguishes | both `true` → `ready` | `RC_FLAG="--REDACTED"` → red |
| ⭐ swappability | the surface is not pinned outside `tools/rc/` | a file with the flag in `tools/lab/` → red, **only it** |
| ⭐ C1 0-LLM | among **executable** lines there is no `claude -p` | `claude -p` in an unused function → red (+ no-pairing, semantically correct) |
| ⭐ does not pair | `claude` calls are only `--version`/`--help`/`command -v` | `claude --remote-control demo` → red, **only it** |
| PC ×4 | SURFACE actually names the flag and the key; the hardcode detector catches a violator; the stripper preserves calls | — |

The harness builds the target literals from fragments (`'--remote'"-control"`), otherwise it
would itself be a violation of its own rule.

## Connections

| | |
|---|---|
| Branch | `GSL-102-mobile` @ **`eebc33e`** (pushed) |
| Epic | GSL-102 = GH #116; tasks GSL-103…GSL-110 = GH #117…#124 |
| Phase 6 PR | **not yet open** |
| Jira | cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/**41=Done** |
| Queue | `q-2026-07-20-003` open (DECISION, default applied by me) |

## Phase 6 task status

GSL-103 **Done** (ledger) · **GSL-104 Done** (this cycle) · GSL-105…GSL-110 **To Do** (6).

## ⚠️ Hard rules

All 20 handoff-35 rules in force without weakening: ⛔ tree-wide git ops · ⛔ force-push · ⛔ `--amend`
after push · ⛔ Workflow tool · ⛔ `git add -A` · fleet cap 3 · NO Story · REGULAR merge ·
`docs/lab/site/*.html` DERIVED · commit via `git commit -F` · dirty tree — norm.

**Owner directive 2026-07-20 (IN FORCE):** `orchestrating-delivery-agents` — global skill only,
do not run `./install.sh` for it. **Practical consequence verified in this cycle:** `install.sh`
installs **all** `skill/` subfolders, i.e. running it whole = violating the directive. Install
your skill point-wise: `rsync -a --delete skill/<name>/ "$HOME/.claude/skills/<name>/"`.

## Gotchas

All prior ones in force. New from me:

- **`claude --help` does not show everything.** Subcommands can be `hidden`. Verify with a grep
  over the binary (`/Users/romanlidovskyi/.local/share/claude/versions/<ver>`) — a minute of
  work, and it refuted the conclusion of the previous cycle.
- **`ugrep` falls** on long `-oE` with `{0,N}` ("exceeds complexity limits") — for parsing the
  binary use python, not grep.
- **`cd` in the Bash tool survives the call**: the next command starts from the same directory.
  Run gates with an absolute `cd <repo>` at the start, otherwise `chronicler.sh` is "not found".
- **`.env.local` is still absent** — GSL-105 hits it first (see RESUME).

---

## ⭐ RESUME POINT — next Phase 6 impl-worker

```bash
# Orient
cat docs/handoff/ORCHESTRATION-STATE.md | head -30
cat docs/handoff/40-2026-07-20-handoff-impl-mob-1.md   # this file
git branch --show-current                 # GSL-102-mobile
git log --oneline -1                      # eebc33e (GSL-104)
tools/lab/lab-emit.sh list --count
tools/rc/rc-preflight.sh                  # current state of the phone path
```

### Recommendation: **GSL-105 `[Tooling]` hook→ntfy fleet/lab push (R6.2 → F6-S3)**

By PRD order the next (104 → 105 → 106; do **not** start GSL-106 before 105). But go in with
open eyes:

1. **Jira description — FIRST tool**, then grep the code. Known: hooks `Notification`,
   `StopFailure`, `SubagentStop` are **already** in `.claude/settings.json` since Phase 4 — this
   is an **extension**, not building from scratch. Do not break the live event stream.
2. **⚠️ Expected BLOCKER (credentials):** `.env.local` is absent, nowhere to take the ntfy topic
   secret. **Do not invent a secret.** Report to the orchestrator immediately, park **only** the
   dependent part and do the unblocked: structure, hook extension, choice of self-hosted/ACL
   scheme, code without the secret, tests for the **degraded path** (what happens when there is
   no topic — should degrade explicitly, not silently fail to send).
3. New bash hooks — **only** behind the shim `tools/hooks/lab-log-hook.sh` (exit 0 always; bare
   `exit 2` will block the operation — this was the impl-lab-1 incident).
4. `.claude/settings.json` is picked up **live**: an edit = immediate effect on the live fleet.
   Do not break the Stop-hook. Validate with `jq .` **and** a real run of `hooks-verify.sh`.
5. Useful from me: **fleet-level push is exactly your task.** Remote Control is per-session by
   construction and does not see a worker that died in an unpaired pane; in the skill and the
   runbook this is recorded as a division of zones, you can lean on it.

### Alternative, if the orchestrator wants a cycle without a blocker

**GSL-108** `[Tooling][Docs]` phone-readable dashboard — fully independent, no secrets, and
closes the **refuted F5-S4c** (private GitHub returns `text/plain` + `nosniff` → HTML from a
phone is unreadable; solve by transport, not by hoping for rendering). **GSL-107** and **GSL-109**
are also independent.

### What is left to the owner on GSL-104 (not to a worker)

One visit, ~2 minutes: turn on the second toggle (runbook section 3) → `/rc` in the orchestrator
pane → wait for a permission prompt → confirm from the phone. **Record the result by fact,
including a negative.** This will also close the open question "does the Agent-Teams LEAD session
behave normally under RC" — nobody checked it, and I did not either.

## Blocked on human

- **GSL-104 / F6-S1:** hands-on pairing + the second push toggle (see above). Does not block the next tasks.
- **GSL-105:** expected BLOCKER on the ntfy topic secret (`.env.local` absent).
