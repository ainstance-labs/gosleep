# Handoff — gosleep — 2026-07-20 (cycle 68, impl-mob-4: GSL-107 break-glass runbook)

> For the orchestrator and the next impl-worker of Phase 6. Read Part 1 → ORCHESTRATOR REPORT → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + handoff 39 (Phase 6 rollout) + 40 (RC) +
> 41 (phone-readable) + 42 (design pass) + this file + handoff 35 (20 rules and 6 lessons — all in force).
> I am the impl-worker of cycle 68. Did exactly one task: **GSL-107**.

# ── Part 1 · Plain words ──

## 1. What was done

**GSL-107** (Jira **In Review**, not Done — why, see section 5; commit `19dfd47`). Wrote a runbook
for emergency access to the fleet from the phone — `docs/runbooks/break-glass.md` — and to go with
it an executable readiness detector `tools/breakglass/bg-preflight.sh`, sibling of `rc-preflight.sh`
from GSL-104.

## 2. Main result: the chain is longer than it is named

The task is named "Tailscale + Blink/mosh". It sounds like two links. There are **five**, and the
description does not mention one at all.

**mosh is not the transport but a passenger on SSH.** It starts a `mosh-server` on the other side
**via SSH**, reads the key and port from its output, and only then switches to its own UDP channel.
So between "tailnet up" and "shell exists" stands an **SSH terminator**. On this machine it does
not exist in either form:

| Link | State (verified 2026-07-20) |
|---|---|
| `tailscale` | **absent** — not on PATH, not in `/Applications`, not in brew |
| tailnet | unavailable without the previous |
| **SSH transport** | **system Remote Login OFF, `:22` closed** ← not in the task description |
| `mosh-server` | **absent** |
| `tmux` | ✅ 3.6a, 9 live sessions — **the only ready link** |

The danger of this link is that its failure **looks like success**: Tailscale green, mosh
installed, the path seems ready. That is why `bg-preflight.sh` verifies the transport separately
and **does not report `ready` on four ready links out of five**.

## 3. A fork with a security price

There are two terminators, and the choice between them is not a matter of taste:

| | Tailscale SSH | system Remote Login |
|---|---|---|
| Port on the machine | **does not open at all** | `:22` on **all** interfaces, including café-Wi-Fi |
| Bundling with mosh | ⏳ not verified here | proven by time |

Acceptance for F6-S4 requires "WITHOUT opening incoming ports". The path through Remote Login
satisfies it **to the letter** (the router is not forwarded) and violates it **at the machine
level**. Recorded as DECISION `q-2026-07-20-004`, default applied: Tailscale SSH as primary,
Remote Login as backup — with a warning and a `ListenAddress` recipe on the tailscale address.

## 4. The kill-pane invariant now has a mechanism instead of a quote

MEMORY carries a HARD lesson 2026-07-07 ("`kill-pane -a` killed the live fleet"). A runbook that
teaches the owner to kill panes from the phone must carry this warning — but a paraphrase of the
lesson does not explain **why** the rule is exactly this. An experiment in an isolated test
session (the live fleet not touched) refined two facts, neither of which followed from the wording:

**The `-a` radius is a window, not a server.** `kill-pane -a -t %427` killed `%429` and `%430`;
panes of the neighboring window survived. That is only formally consoling: **the gosleep fleet
lives as panes in one window** (`12:0.0`…`12:0.3`), so for this project `-a` practically means
"kill all workers but yourself".

**Positional addresses get renumbered.** After `%428` died the pane `%429` changed address
`0.2` → `0.1`, **without changing its id**. From the phone, minutes pass between "read the list"
and "type the command", during which a worker can finish on its own — and `kill-pane -t 12:0.2`
will kill **not the pane that was read**. The rule "only by an explicit `%id`" stops being
superstition and becomes a consequence.

**Separately: attach from the phone distorts the desktop fleet.** `window-size` = `latest`, i.e.
the window size is set by the last active client. The phone squeezes panes **for everyone**, and
in the morning the owner meets a mangled layout. Therefore phone attach in the runbook is always
`-r -f ignore-size` (both flags verified on 3.6a; control — `-Z` gives `unknown flag`).

## 5. Why Jira **In Review**, not Done

The task description names **F6-S4** the acceptance — "`tmux attach` to a live pane from the
phone is possible". Four of five links on the machine are absent, so a live run was not and could
not be. I did not install Tailscale myself: installing a system VPN on the owner's machine
without his command is a BLOCKER class.

The deliverable is ready and verified in the part that is verifiable; acceptance requires an
owner step. `In Review` describes this precisely, `Done` would be a statement about an unverified
capability. **The orchestrator decides** — if consistency with GSL-104 (there Done on a
blocked-on-human acceptance) matters more, transition 41 is one command.

## 6. Problems

No blockers on my task. For the next worker — see ⭐ RESUME.

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Task** | **GSL-107** `[Docs]` → Jira **In Review** (verified by GET), GH #121 **not closed** |
| **Commit** | **`19dfd47`** — 5 files, **+872/−0**, per-file (`git add` by list, not `-A`) |
| **Gates** | smoke **303/303** (287 base + 16 new, **0 removals — no old asserts weakened**) · hooks-verify **14/14** · `tsc --noEmit` **0** · chronicler **FRESH**, 7 pages |
| **Mutants** | **8 ⭐, each reddens EXACTLY its own** — run on a copy in scratchpad, live tree untouched |
| **Decisions** | **`q-2026-07-20-004`** (DECISION, transport) — filed, default applied, queue `open=1` |
| **Schema** | `render/7` untouched; `docs/lab/*` not committed (DERIVED + foreign edits) |
| **install.sh** | **untouched**, guard not removed; global skills untouched |
| **Model** | **`claude-opus-4-8`** — verified from the transcript (see below), not self-report |
| **Acceptance** | ✅ 7 items of the description (of them 2 by a live run) · ⏳ **F6-S4 NOT CLOSED** |

**Model check.** Transcript identified by session-id from the scratchpad path:
`~/.claude/projects/…/b4b5c84b-f286-45c2-b6fa-6a34289b7aa5.jsonl` → `"model":"claude-opus-4-8"`,
**129 records, only value**. ⚠️ The first file I took (freshest by `mtime`) turned out to be a
**foreign** session on `claude-fable-5` — "freshest by mtime" does **not** mean "mine", the anchor
is only session-id.

---

# ── Part 2 · Formal ──

## What was changed

| File | Role |
|---|---|
| `tools/breakglass/bg-preflight.sh` | **new**, 227 lines — chain detect, `--json`, codes 0/1/2, `SURFACE` block, 0-LLM |
| `docs/runbooks/break-glass.md` | **new**, 323 lines — 8 sections, ⏳ marks in the header |
| `tools/lab/smoke.sh` | **+157/−0** — GSL-107 block, 16 asserts (8 ⭐ + positive controls) |
| `docs/dev_history/GSL-107-…md` + `README.md` | dev history + index line |

## Tests (⭐ = has a mutant that reddens exactly it)

| ⭐ | Mechanism | Mutant |
|---|---|---|
| green tailnet without transport ≠ ready | verdict on `RunSSH=false` + sshd off | soften the "no transport at all" branch |
| `unknown` is not rounded up | unreadable prefs → `tailscale_ssh=unknown`, status ≠ ready | count `!= off` as transport |
| exposure of the backup path is named | `:22 on EVERY interface` in the output | remove the warning |
| preflight does not mutate the machine | grep executable lines | append `tailscale up --ssh` |
| runbook forbids `kill-pane -a` | text + `⛔`/`NEVER` | soften the wording |
| …and explains **why** | requires an explanation of renumbering | remove the mechanism, keep the rule |
| every copyable attach command carries `ignore-size` | lines `tmux attach -t` **without** the flag = 0 | drop the flag from commands |
| F6-S4 still open | `NOT CLOSED` in the acceptance table | replace with ✅ |

**Testing is hermetic:** fake `tailscale`/`mosh-server`/`tmux` in `$WORK`, sshd state via
`BG_SSHD_STATE`. Verdicts do not depend on whether the owner installs Tailscale tomorrow.

### Mutants found a weak test, not just confirmed strong ones

The first version of the `ignore-size` check grepped the document for the word itself. A mutant
removed the flag from **all three** copyable commands, leaving the explanatory table, — and the
test **passed**. That is exactly the edit a future rewriter would make. The check is rewritten
to be **per-command**.

### And caught a false positive in the detector itself

"preflight does not mutate the machine" reddened on the line
`TAILNET_STATE="down"; warn "… tailscale up is an owner step"`. There is no call there — there is
**warning text**; the stripper drops a line only if it **begins** with a printing function. Fixed
in the script (warn on a separate line + a comment about the reason), a **positive control** on a
real `tailscale up --ssh` added to the detector.

## Connections

| | |
|---|---|
| Branch | `GSL-102-mobile` @ **`19dfd47`** (+ this handoff) |
| Epic | GSL-102 = GH #116; tasks GSL-103…GSL-110 = GH #117…#124 |
| Phase 6 PR | **not yet open** |
| Jira | cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/**31=In Review**/41 |
| Queue | `open=1 (0B/1D/0C/0F)` — my `q-2026-07-20-004` |

## Phase 6 task status (verified by JQL, not from memory)

**Done (4):** GSL-103 · GSL-104 · GSL-108 · GSL-109.
**In Review (1):** **GSL-107** (this).
**To Do (3):** GSL-105, GSL-106, GSL-110.

## ⚠️ Hard rules

All 20 handoff-35 rules in force without weakening: ⛔ tree-wide git ops · ⛔ force-push · ⛔ `--amend`
after push · ⛔ Workflow tool · ⛔ `git add -A` · fleet cap 3 · NO Story · REGULAR merge ·
`docs/lab/site/*.html` DERIVED · commit via `git commit -F` · dirty tree — norm.
**Owner directive 2026-07-20 (IN FORCE):** `./install.sh` whole not run (GUARD, exit 1 — do
not remove and do not bypass); point-`rsync -a skill/<name>/ ~/.claude/skills/<name>/`; the global
copy `orchestrating-delivery-agents` is authoritative.

## Gotchas

All prior ones in force. New from me:

- **`kill-pane -a` hits the window, not the server** — but the fleet is in one window, the
  difference consoles only formally.
- **`window-size` = `latest`**: any new client overrides the window size for everyone else.
  Phone attach without `-f ignore-size` mangles the desktop layout.
- **The comment stripper (`rc-`/`bg-preflight` harness) drops a line only if it BEGINS with a
  printing function** — `X=1; warn "…"` reads as an executable line.
- **"Freshest transcript by `mtime`" ≠ "mine".** There are several live sessions on the machine;
  someone else's would give the wrong model in the report. Anchor — session-id from the scratchpad
  path.
- **App Store Tailscale build hides the CLI inside the bundle** (`…/Tailscale.app/Contents/MacOS/Tailscale`).
- **Tailscale device keys expire**: a Mac "just stopped responding" after months — likely an
  expired key, not a breakdown.
- **zsh does not know `PIPESTATUS`** (it has `pipestatus`) — broke one diagnostic run.

---

## ⭐ RESUME POINT — next Phase 6 impl-worker

```bash
# Orient
head -30 docs/handoff/ORCHESTRATION-STATE.md
cat docs/handoff/43-2026-07-20-handoff-impl-mob-4.md   # this file
git branch --show-current                 # GSL-102-mobile
git log --oneline -1                      # 19dfd47 (GSL-107) + handoff commit
ls -la .env.local 2>/dev/null || echo "GSL-105 still blocked"
tools/breakglass/bg-preflight.sh || true  # 2 = unavailable, expected
tools/lab/lab-emit.sh list --count
```

### Verified by me by fact, not inherited (2026-07-20, end of cycle 68)

| | |
|---|---|
| `.env.local` | **ABSENT** — GSL-105 blocker in force, nothing changed |
| `tailscale` / `mosh` | **not installed** |
| **system Remote Login** | **off**, `:22` closed — a new fact, not previously recorded |
| question queue | `open=1 (0B/1D/0C/0F)` — my DECISION on transport |

### Phase remainder

- **GSL-105** — **BLOCKER** on the ntfy topic secret: `.env.local` still absent. Do not take.
- **GSL-106** — PRD requires it be done **after** 105 ⇒ transitively blocked.
- **GSL-110** `[Docs]` Phase 6 dev_history + F6-S1..S4 acceptance — **the only unblocked one**.
  Note: its acceptance **will not close entirely** — F6-S1 waits for the owner's hands-on
  (handoff 40), F6-S2/S3 hit unresolved 105/106, F6-S4 — on the absence of Tailscale. The task
  remains meaningful: Phase 6 dev_history is written per what actually landed, and acceptance
  is recorded **by fact**, with ⏳ where there is no evidence. The honesty-of-acceptance rule
  is written directly in its description — do not soften wording to fit what can be met.

**Recommendation:** GSL-110 as the closer, with an honest ⏳ table. If the owner installs
Tailscale or puts down `.env.local` — the priority flips to 107-acceptance / 105 accordingly.

### Warning about my work

`bg-preflight.sh` is written against the **documented** Tailscale surface — it is absent on the
machine, and only the tmux part is confirmed by a live run. Therefore probes have **three**
states, and `unknown` is never rounded up. When Tailscale appears, **the first run is mandatory
exactly as a check of the script**: if it says `ready` where the path does not work — the defect
is in the `SURFACE` block, not in the chain. Sections 2/3/6 of the runbook are marked ⏳ for
exactly the same reason.

## Blocked on human

- **GSL-107 / F6-S4 (mine):** install Tailscale and **in daylight, not in an emergency**, walk
  through runbook section 7. Sign of closure — `bg-preflight.sh` with status `ready`. Currently
  honestly `unavailable`.
  ⚠️ Installing a system VPN is a BLOCKER class for an agent, owner only.
- **GSL-109:** owner's look at the 7 screens (handoff 42). Record the result including a negative.
- **GSL-108 / F5-S4c:** final look from a real phone (handoff 41).
- **GSL-104 / F6-S1:** hands-on pairing + the second push toggle (handoff 40).
- **GSL-105:** BLOCKER on the ntfy topic secret — `.env.local` **verified, absent**.
