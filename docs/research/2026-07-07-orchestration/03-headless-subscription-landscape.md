# 03 — Headless mode (`claude -p`), subscription compatibility, and the orchestrator landscape

> GSL-41 research worker: `res-headless`. Date: 2026-07-07.
> Scope: what `claude -p` actually is; whether GoSleep can run on a Claude Pro/Max **subscription** (not API key);
> Anthropic's official position on automation over subscriptions; landscape of alternative multi-agent orchestrators.
> Every policy claim is dated and sourced. FACT vs COMMUNITY-REPORT vs SPECULATION is labelled explicitly.

## Status

- [x] 1. `claude -p` / headless mode explained (incl. Agent SDK relationship)
- [x] 2. Subscription vs API key: what works, official policy, risk assessment
- [x] 3. Approach matrix for GoSleep + recommendation
- [x] 4. Orchestrator landscape survey + top-3 deep dives
- [x] 5. What to adopt in gosleep

**COMPLETE 2026-07-07.** See `## COVERAGE` at the end for gaps/caveats.

---

## 1. What `claude -p` actually is (explained from zero)

> All claims in this section from official docs (code.claude.com/docs, fetched 2026-07-07; docs last updated 2026-07-06), via a dedicated docs-research subagent + direct fetch of [headless.md](https://code.claude.com/docs/en/headless.md).

### The plain-English version

Normally `claude` opens a chat UI in your terminal and waits for you. **`claude -p "do X"` (`--print`) runs the exact same agent once, with no UI: it does the task, prints the answer, and exits.** That turns Claude Code into a shell command you can pipe, script, cron, and loop — `cat build-error.txt | claude -p 'explain the root cause' > out.txt` works like any Unix tool. It is *not* a different product or a raw API call: same model, same tools (Bash/Read/Edit/…), same CLAUDE.md/skills/MCP context as an interactive session (unless you pass `--bare`), same login.

The two things that change vs interactive:
1. **Nobody can answer permission prompts.** You pre-approve tools (`--allowedTools "Bash(git diff *),Read,Edit"`) or set a `--permission-mode`; anything not pre-approved either auto-denies (`dontAsk`) or **aborts the run** (default modes). `--dangerously-skip-permissions` removes prompts entirely (with a few hard-coded circuit breakers like `rm -rf /`).
2. **Output becomes machine-readable** with `--output-format json` (result + `session_id` + `total_cost_usd` + usage) or `stream-json` (real-time event stream). `--json-schema` forces structured output.

### Flags that matter for orchestration (official semantics)

| Flag | What it gives an orchestrator |
|---|---|
| `-p` / `--print` | one-shot non-interactive run; reads stdin (capped 10MB since v2.1.128) |
| `--output-format json\|stream-json` | parseable result, session id, per-call cost; stream-json + `--verbose --include-partial-messages` = live token/event stream (incl. `system/init`, `system/api_retry` events) |
| `--resume <session-id>` / `--continue` | multi-step workflows across separate invocations — state persists server/disk-side; session lookup is scoped to the project dir + its worktrees |
| `--allowedTools` / `--disallowedTools` | permission-rule syntax (`Bash(git commit *)`); the whole safety model for unattended runs |
| `--permission-mode` (`acceptEdits`, `dontAsk`, `plan`, `bypassPermissions`…) | baseline permission posture; `dontAsk` = fully non-interactive deny-by-default |
| `--permission-prompt-tool <mcp tool>` | delegate approvals to your own MCP tool — programmatic human-in-the-loop |
| `--mcp-config`, `--agents`, `--append-system-prompt(-file)` | inject MCP servers, custom subagents (JSON), extra system prompt per call |
| `--max-turns`, `--max-budget-usd` | hard caps per run (budget cap is print-mode only) |
| `--bare` | skip ALL auto-discovery (hooks/skills/plugins/MCP/CLAUDE.md) for reproducible CI runs. ⚠️ **`--bare` also skips OAuth/keychain — subscription login does NOT work in bare mode** (API key / apiKeyHelper only). Docs say bare "will become the default for `-p` in a future release" — a flag worth pinning. |
| Skills | `/skill-name` inside the `-p` prompt string works; interactive builtins (`/login`) don't |

### Agent SDK: same engine, library form

The **Claude Agent SDK** (TypeScript `@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`; renamed from "Claude Code SDK") is officially described as the same thing at a different surface: the docs literally frame `claude -p` as "using the Agent SDK via the CLI". Mechanically the SDK **bundles/spawns the Claude Code binary** and talks to it over stdio — it is not a separate implementation. What it adds over shelling out to `claude -p`: in-process hooks (PreToolUse/PostToolUse/Stop/…), in-process custom tools (`createSdkMcpServer`), a `canUseTool` permission callback (programmatic approval mid-run), native session objects (`listSessions`, `forkSession`), structured outputs, streaming input for bidirectional conversations. One breaking difference: since SDK v0.1.0 it does **not** default to Claude Code's system prompt (opt-in preset). Official guidance: "CLI for daily development, SDK for production" — and, critically for us, **SDK docs only document API-key / cloud-provider auth** (see §2).

### Authentication in headless mode (official precedence, highest wins)

1. Cloud provider creds (Bedrock/Vertex/Foundry) → 2. `ANTHROPIC_AUTH_TOKEN` → 3. `ANTHROPIC_API_KEY` (*"in non-interactive mode the key is always used when present"* — a stray exported key silently hijacks your subscription; `unset ANTHROPIC_API_KEY` to fix) → 4. `apiKeyHelper` → 5. `CLAUDE_CODE_OAUTH_TOKEN` (from **`claude setup-token`**: official, one-year, **subscription-backed** token for CI/scripts, inference-only scope, requires Pro/Max/Team/Enterprise) → 6. **subscription OAuth from `/login` — the default for Pro/Max users.**

**Bottom line: `claude -p` on a logged-in Pro/Max machine just works on the subscription, by design, today** — and there is even an official subscription token (`setup-token`) for headless environments, which `anthropics/claude-code-action` accepts as a first-class input ([action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml): *"Pro and Max users can generate this by running `claude setup-token` locally"*). The explicit line Anthropic draws (verbatim, [agent-sdk/overview.md](https://code.claude.com/docs/en/agent-sdk/overview.md)): *"Unless previously approved, Anthropic does not allow third party developers to **offer claude.ai login or rate limits for their products**, including agents built on the Claude Agent SDK. Please use the API key authentication methods described in this document instead."* — i.e. the ban is on *products offering subscription auth to others*; docs are **silent** on private personal automation via SDK + your own subscription token (undocumented/unendorsed — avoid).

### Official scheduled/autonomous surfaces (for the matrix)

- **Routines** ([routines.md](https://code.claude.com/docs/en/routines.md)) — cloud scheduled agents on claude.ai infra: saved prompt + repos + MCP connectors, cron (≥1h), API-fire, or GitHub-event triggers; run **fully autonomously, no permission prompts**; **require subscription login** (a set `ANTHROPIC_API_KEY` breaks the feature!); consume subscription usage + a separate daily routine cap. Research preview — surface may change.
- **`/loop` + scheduled tasks** ([scheduled-tasks.md](https://code.claude.com/docs/en/scheduled-tasks.md)) — local, session-scoped cron (dies with session, 7-day expiry); **Desktop scheduled tasks** — run on your machine via the Desktop app.

---

## 2. Subscription vs API key: policy timeline

### The policy timeline (each entry dated + sourced)

| Date | Event | Status | Source |
|---|---|---|---|
| **2025-07-28** | Anthropic announces **weekly rate limits** for Pro/Max (effective 2025-08-28), stacked on the rolling 5-hour window. Stated reasons: a small number of users running Claude Code "essentially 24/7", account sharing, resale of access. One user reportedly consumed "tens of thousands of dollars" of model usage on a $200 plan. | FACT | [HN thread](https://news.ycombinator.com/item?id=44713757), [HN: Max account email](https://news.ycombinator.com/item?id=44713837), TechCrunch coverage cited therein |
| **2026-01-09** | Anthropic silently deploys **server-side checks**: third-party tools using Pro/Max OAuth tokens start receiving `"This credential is only authorized for use with Claude Code and cannot be used for other API requests."` | FACT (widely reported; enforcement observed) | [Natural20 coverage](https://natural20.com/coverage/anthropic-banned-openclaw-oauth-claude-code-third-party), [Rida Kaddir](https://ridakaddir.com/blog/post/did-anthropic-kill-opencode-claude-subscription-ban) |
| **2026-02-19** | Anthropic formalizes this in updated **Consumer Terms of Service** — new "Authentication and credential use" section: OAuth credentials from Free/Pro/Max accounts are **only for Claude Code and claude.ai**; using them in any other product/tool/service — reportedly **including Anthropic's own Agent SDK** — violates the Consumer ToS. | FACT (ToS change); the "includes Agent SDK" detail needs primary-source verification | [Winbuzzer 2026-02-19](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [MLQ News](https://mlq.ai/news/anthropic-ends-paid-access-for-claude-in-third-party-tools-like-openclaw/), [HN thread](https://news.ycombinator.com/item?id=46549823) |
| **2026-04-04** | Reported further enforcement wave: Pro/Max subscriptions blocked from "most third-party agent frameworks" (e.g. Ruflo/claude-flow now API-key-only). Same secondary source: for Pro/Max users, **official Agent Teams is now the only fully-supported multi-agent orchestration option**; API users unaffected. | COMMUNITY-REPORT (single secondary source; consistent with the Jan/Feb enforcement trajectory — treat scope details as unverified) | [claudefa.st orchestrator comparison](https://claudefa.st/blog/tools/orchestrators/multi-agent-orchestrators) |
| **2026-04-04/05** (confirmed) | Enforcement effective **2026-04-04 12PM PT**: Claude subscriptions no longer cover usage through third-party tools (OpenClaw — 247k★ agent framework — named first; "all third-party harnesses in the coming weeks"). Compensation: one-time credit equal to one month's subscription price (redeem by 2026-04-17), up to 30% off Extra-Usage bundles, or full refund. Days later (**2026-04-08**) Anthropic launched **Claude Managed Agents** — hosted agents on the API — widely read as "the sanctioned replacement for third-party agent infra". | FACT (multiple independent outlets; announcement was via X/VentureBeat — no single canonical Anthropic page found) | [BigGo 2026-04-05](https://finance.biggo.com/news/202604050055_Anthropic-Claude-blocks-third-party-AI-agents-subscription), [marketingagent.blog 2026-04-04](https://marketingagent.blog/2026/04/04/anthropic-bans-third-party-ai-agents-from-claude-subscriptions/), [TNW](https://thenextweb.com/news/anthropic-openclaw-claude-subscription-ban-cost), [Ewan Mak on Managed Agents timing](https://medium.com/@tentenco/anthropic-managed-agents-what-it-is-what-it-kills-and-why-the-timing-matters-0f70c1822f93) |
| **2026-06-15** | **Programmatic usage split off from interactive quota.** Per a May Help-Center notice (as reported by secondary guides): *"Programmatic usage (the Agent SDK, `claude -p` scripts, GitHub Actions, third-party agent apps) splits into its own monthly credit pool: $20 on Pro, $100 on Max 5x, $200 on Max 20x, billed at API list rates."* Interactive terminal usage is explicitly unaffected ("Typing into Claude Code in your terminal is unaffected"). | FACT with medium confidence — consistent across secondary guides and matches ralph's ADR of the same date; we could not surface the primary Help-Center notice text directly (the two help articles we fetched don't mention it) | [ccforeveryone guide (June 2026)](https://ccforeveryone.com/guides/claude-code-limits-and-pricing) |
| **2026-06-15** | Ralph-for-Claude-Code maintainer records in ADR 0001 (same date): *"Anthropic is moving `claude -p` headless billing toward API credits (no OAuth / subscription quota)"* — and pivots the project to provider-agnostic adapters as a hedge. Also **rejects** the "drive the interactive TUI programmatically to spend subscription quota" workaround (maestro-p) as *"adversarial to the vendor's billing intent and plausibly against terms"*. | FACT (that the ADR says this); corroborates the row above | [ralph ADR 0001](https://github.com/frankbria/ralph-claude-code/blob/main/docs/adr/0001-multi-provider-agent-abstraction.md), local clone `.research-cache/ralph-claude-code/docs/adr/` |

### Where `claude -p` on subscription stands TODAY (2026-07-07)

- **`claude -p` still works while logged in with a Pro/Max subscription — but since ~2026-06-15 it no longer draws from the "unlimited-feeling" interactive quota.** It draws from a **separate monthly programmatic credit pool** included in the plan ($20 Pro / $100 Max 5x / $200 Max 20x), metered at **API list rates**. Interactive terminal use of Claude Code is unaffected and keeps the classic 5-hour + weekly limit model. (FACT, medium confidence — see timeline row.)
- **Implication for overnight autonomy:** a Max 20x plan gives ≈$200/month of programmatic credit. A busy overnight `claude -p` fleet at API rates can burn that in days. So "headless on subscription" is now *legal and supported but budget-capped*, not a flat-rate loophole.
- **It is the official CLI**, so the Jan–Apr 2026 OAuth/third-party crackdowns do *not* apply to it — the enforcement error message itself says credentials are "only authorized for use with Claude Code". Scripting the official CLI ≠ third-party harness on your OAuth token. FACT for the mechanism; and the June split shows Anthropic's chosen resolution: **meter it, don't ban it**.
- **Interactive-CLI orchestration (tmux + Agent Teams — gosleep's current approach) remains on the interactive quota** (5h/weekly windows), which is far more generous per dollar than API-rate credits. The 2025-07-28 weekly limits remain the volume backstop against 24/7 background use.
- **Residual risk:** the programmatic credit pool sizes/rates can be re-tuned at will, and one secondary source (claudefa.st) still describes official Agent Teams as "the only fully-supported orchestration option" for Pro/Max. Betting-the-project risk sits with *third-party harnesses*, not with the official CLI in either mode. Ralph's maintainer independently reached the same read.

### Practical rules-of-thumb this yields for gosleep

1. **Stay on official surfaces** (Claude Code interactive, Agent Teams, subagents, `claude -p`, official cloud/scheduled agents) → subscription-legal today, and the surfaces Anthropic keeps carving out for subscribers.
2. **Prefer interactive-quota surfaces (tmux + Agent Teams) for bulk work; treat the programmatic credit pool as a bounded budget** for `claude -p` glue (headless report generation, cron checks), not the main engine.
3. **Never** pipe a subscription OAuth token into anything that isn't Claude Code/claude.ai (Agent SDK included) — explicit Consumer-ToS violation since 2026-02-19, technically blocked since 2026-01-09, commercially terminated 2026-04-04.
4. Design for graceful quota-wait (ralph's "auto-wait on limit" pattern); budget API credits or Extra Usage for overflow.

### Practical rules-of-thumb this yields for gosleep

1. **Stay on official surfaces** (Claude Code interactive, Agent Teams, subagents, `claude -p`, official cloud/scheduled agents) → subscription-legal today, and the surfaces Anthropic keeps carving out for subscribers.
2. **Never** pipe a subscription OAuth token into anything that isn't Claude Code/claude.ai (Agent SDK included) — that's an explicit Consumer-ToS violation since 2026-02-19 and technically blocked since 2026-01-09.
3. Treat quota (5h/weekly) as the real constraint for overnight autonomy on subscription; design for graceful quota-wait (ralph's "auto-wait on limit" pattern), or budget API credits for the overflow.

---

## 4. Orchestrator landscape 2025–2026 (survey)

> Method: web sweep + cloned source inspection (`.research-cache/{gastown,claude-squad,ralph-claude-code}`). Sibling reports cover autosk (01) and warren/overstory (02) — excluded here.
> **The one question that now sorts this whole landscape: HOW does the tool spawn Claude?** (a) interactive `claude` in tmux/pty → subscription-OK; (b) `claude -p` loops → subscription-OK today, rumor-risk; (c) Agent SDK / raw API → API-key-only, subscription use banned.

### First-party (Anthropic) — the sanctioned set

Claude Code now ships **four first-party multi-agent primitives**: subagents; skills; **Agent Teams** (shipped ~Feb 2026 with Opus 4.6; requires Claude Code ≥2.1.32 + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; one lead session spawns teammate sessions with own context windows, peer-to-peer messaging, shared task list); and **workflows** (dynamic multi-agent surface, research preview June 2026). Sources: [official Agent Teams docs](https://code.claude.com/docs/en/agent-teams), [Developers Digest comparison](https://www.developersdigest.tech/blog/claude-code-subagents-vs-agent-teams-vs-workflows). All run inside Claude Code → subscription-compatible. **This is what gosleep already uses.**

### Third-party survey (one block each)

- **Gastown + Beads** (Steve Yegge; `gastownhall` org, hosted flavor by Kilo). Multi-agent workspace manager for 20–30 parallel coding agents (Claude Code, Copilot, Codex, Gemini). Architecture: a "Mayor" (Claude Code instance) coordinates; "polecats" (worker agents) get persistent identity + ephemeral sessions; work state persists in **Beads**, Yegge's git-backed issue tracker (~24k★), via git-worktree "hooks"; mailboxes/handoffs built in. **Spawn mechanism (verified in source): tmux sessions running interactive `claude`** (`internal/polecat/session_manager.go` — `NewSessionWithCommandAndEnv` + `WaitForRuntimeReady`) → subscription-compatible. Go, very active, v1.x as of 2026-04. Closest large project to gosleep's philosophy (persistent ledger + interactive-CLI fleet).
- **Claude Squad** (`smtg-ai/claude-squad`, ~8k★, brew-installable as `cs`). TUI that manages N agent instances, each in its own tmux session + git worktree; background "yolo" mode; diff review before apply. **Spawn (verified in source): `tmux new-session -d -s claudesquad_<name> -c <worktree> claude`** — interactive CLI → subscription-compatible. Multi-agent in the "parallel tasks" sense, not agent-to-agent coordination. Mature, simple, single-machine.
- **Ralph-style runners** — Geoffrey Huntley's "Ralph Wiggum" technique (coined Jul 2025): infinite shell loop re-invoking the agent with the same prompt file; filesystem as memory; famous for months-long runs and overnight project builds ([ghuntley.com/loop](https://ghuntley.com/loop/), [The Register 2026-01-27](https://www.theregister.com/2026/01/27/ralph_wiggum_claude_loops/)). Best maintained implementation: **`frankbria/ralph-claude-code`** (v0.11.5, 784 tests): loops **`claude -p`** with `--output-format json`, `--allowedTools`, session `--resume`, rate limiter (100 calls/h), circuit breaker (stagnation/error/permission-denial), dual-condition exit gate (heuristics + explicit `EXIT_SIGNAL`), subscription-limit auto-wait, tmux monitor dashboard, Docker/E2B sandboxes, GitHub-issue queue. Subscription-compatible today (see §2). Claude Code also now has a first-party `/loop` command covering the simple case.
- **Ruflo** (ex-**claude-flow**, `ruvnet`; renamed Jan 2026 after trademark conversation with Anthropic; 31.1k★ — most-starred orchestrator). "Hive-mind/queen" swarm topologies, 87 MCP tools, neural-routing marketing, big performance claims (84.8% SWE-bench solve; treat as vendor claims — community routinely disputes them). Runs via SDK/API → **API-key-only; blocked for Pro/Max subscription use as of the Apr 2026 enforcement** (per claudefa.st). High activity, high hype, heavy dependency surface. Poor fit for a subscription-first project.
- **vibe-kanban** (`BloopAI/vibe-kanban`). Kanban board UI over parallel coding agents (10+ CLIs incl. Claude Code); each card = workspace with branch/terminal/dev-server; inline diff review. Bloop (the company) shut down 2026-04-10; project continues community-maintained under Apache-2.0. Runs local CLIs → subscription-compatible, but maintenance risk post-shutdown.
- **Conductor** (Mac app) and **Crystal** (Electron). Desktop UIs that run each Claude Code session in an isolated git worktree with diff/PR review. Both drive the official CLI → subscription-compatible. Good for human-supervised parallelism; no autonomous scheduling; closed/GUI form factor doesn't compose with gosleep's tmux/skill approach.
- **ccpm** (`automazeio/ccpm`, ~7.9k★). Shell-based: GitHub Issues as the coordination layer — each issue → worktree → agent, reporting back to the issue thread. Spawns official CLI → subscription-compatible. Philosophically close to gosleep's Jira/GitHub mirroring conventions.
- **Mission Control** (`builderz-labs`, ~3.8k★). Self-hosted dashboard for task dispatch/monitoring/spend governance layered *over* an executor (Ruflo or Claude Squad); not an executor itself.
- **Swarm SDK** (`parruda`). Low-level primitives to wire Claude Code sessions into swarms; you write the orchestrator. DIY tier.
- (Covered by sibling reports: **autosk** → `01-autosk.md`; **warren**, **overstory** → `02-warren-overstory.md`.)

### Top-3 most relevant for gosleep (deep dives follow)

1. **Gastown/Beads** — persistent work ledger + interactive-CLI fleet at 20–30-agent scale; the "what gosleep wants to be when it grows up" reference.
2. **Ralph (`ralph-claude-code`)** — the overnight-autonomy engine: `claude -p` loop hardening (exit gates, circuit breaker, quota auto-wait) is exactly the machinery a "GoSleep" needs.
3. **Claude Squad** — the minimal tmux+worktree fleet manager; validates/informs gosleep's current tmux pane approach.

### Deep dive 1: Gastown + Beads (Steve Yegge)

Source: cloned repo `.research-cache/gastown` (Go, shallow clone 2026-07-07) + README + web coverage.

- **Model.** A *Town* (`~/gt/`) holds *Rigs* (one per git repo). Each rig has *Crew* (human workspace), *Polecats* (worker agents — **persistent identity, ephemeral sessions**), and *Hooks* (git-worktree-backed persistent storage that survives crashes). *The Mayor* — a Claude Code instance with full workspace context — is the coordinator you talk to. *Convoys* bundle work items; convoys labeled `mountain` get **autonomous stall detection and smart skip logic** for epic-scale runs. All work state lives in **Beads** — Yegge's git-backed issue tracker (~24k★) — so "agent memory" is structured data in git, not conversation history.
- **Spawn mechanism (source-verified).** `internal/polecat/session_manager.go`: workers start as **tmux sessions running the interactive `claude` CLI** (`NewSessionWithCommandAndEnv` → `WaitForCommand` → `WaitForRuntimeReady` with `ClaudeStartTimeout`, plus a startup-prompt delivery fallback). It also detects **"zombie sessions (tmux alive but Claude dead)"** so they're not reported as running. Subscription-compatible by construction — it drives the official client on the interactive quota.
- **Scale & maturity.** Pitch: "4–10 agents become chaotic → scale comfortably to 20–30". Very active through 2026 (v1.x under `gastownhall` org; hosted flavor by Kilo). Go codebase, non-trivial to vendor; the *ideas* port cheaply.
- **Relevance to gosleep.** This is gosleep's architecture at 10× scale: Mayor≈orchestrator, polecats≈workers, Beads≈Jira/GH-issues+handoff files, hooks≈worktrees. The pieces gosleep lacks and gastown has: zombie-session detection, mailbox-based agent-to-agent handoff, per-worker persistent identity, convoy stall detection.

### Deep dive 2: Ralph (`frankbria/ralph-claude-code`)

Source: cloned repo `.research-cache/ralph-claude-code` (bash, v0.11.5, 784 tests) — README, CLAUDE.md, ADR 0001.

- **Loop mechanics.** Each iteration: build context (loop #, remaining `fix_plan.md` tasks, circuit-breaker state, previous-loop summary, corrective guidance) → invoke **`claude -p`** with `--output-format json`, `--allowedTools`, session `--resume` (session id persisted, 24h expiry) → analyze the JSON response → decide continue/exit. Filesystem (`.ralph/PROMPT.md`, `fix_plan.md`, `status.json`) is the memory, per the original Ralph-Wiggum doctrine.
- **The hardening layers (the actual value):**
  - **Dual-condition exit gate** — needs ≥2 heuristic completion indicators **AND** an explicit `EXIT_SIGNAL: true` in a structured `RALPH_STATUS` block; prevents both premature exit (docs containing the word "done") and infinite loops.
  - **Circuit breaker** — CLOSED→HALF_OPEN→OPEN on: 3 no-progress loops, 5 same-error loops, >70% output decline, 2 permission-denial loops; cooldown auto-recovery for unattended runs.
  - **Quota handling** — 4-layer API/subscription-limit detection (timeout guard → structural `rate_limit_event` JSON → filtered text → Extra-Usage exhaustion); **unattended mode auto-waits** for the window to reset instead of dying.
  - **Question detection** — catches Claude asking questions instead of acting (headless has no human), suppresses false breaker-trips, injects corrective guidance next loop.
  - **File protection** — granular `Bash(git add *)`-style allowlists + integrity check each loop so the agent can't delete its own control files.
  - Rate limiter (100 calls/h), git backup branches + rollback, tmux monitor dashboard, Docker/E2B sandboxes, GitHub-issue queue with priority/dependency ordering.
- **Strategic read (ADR 0001, 2026-06-15).** The maintainer bets that `claude -p` moves to API-credit billing, refuses to drive the interactive TUI programmatically (*"adversarial to the vendor's billing intent and plausibly against terms"*), and goes provider-agnostic (Claude/Codex/Gemini/OpenCode/Droid/Kilocode/Copilot adapters, with a probed capability matrix). Two details worth stealing: only **Claude and Gemini support race-free pre-assigned session ids** (`--session-id <uuid>` at create); "unsupported features degrade with a logged warning, never a silent misbehavior."
- **Relevance to gosleep.** GoSleep's literal namesake problem — running while the owner sleeps — is what ralph's exit gates, breaker, and quota auto-wait solve. These are bash-portable patterns, directly liftable into an orchestrator skill.

### Deep dive 3: Claude Squad (`smtg-ai/claude-squad`)

Source: cloned repo `.research-cache/claude-squad` (Go TUI) + README.

- **Model.** One TUI (`cs`) listing N *instances*; each instance = a git worktree (or branch) + a tmux session; you create/pause/resume/attach; review diffs before applying; optional background "yolo" auto-accept mode. Also runs Codex/Gemini/Aider — the "program" per instance is configurable.
- **Spawn mechanism (source-verified).** `session/tmux/`: `tmux new-session -d -s claudesquad_<name> -c <workdir> claude`, attach via `tmux attach-session`. Pure interactive CLI in tmux → subscription quota, zero ToS surface. PTY management + window-size monitoring is handled per platform.
- **Maturity.** ~8k★, brew-installable, CI'd; simple by design. No agent-to-agent coordination, no scheduler — it's a fleet cockpit, not an orchestrator.
- **Relevance to gosleep.** Independently converges on gosleep's exact spawn pattern (tmux + interactive claude), which is reassuring; its per-instance **worktree isolation** and pause/resume UX are the concrete ideas to borrow. Also a useful reference for tmux session-naming/sanitization and zombie-window handling in Go if gosleep ever tools up beyond skills.

---

## 3. Approach matrix for GoSleep

| Approach | Works on subscription? | Autonomy (can it run overnight?) | Supervision over orchestrator? | Shutdown/ToS risk | Cost | Verdict |
|---|---|---|---|---|---|---|
| **A. Interactive Claude Code + Agent Teams in tmux** *(current gosleep)* | ✅ — interactive quota (5h/weekly windows), the most generous $/token surface | Medium-high: fleet runs unattended while quota lasts; needs the lead alive (pulse/wake-ups); weekly caps are the ceiling | ✅ best-in-class: every pane observable/steerable; human can attach anytime | **Low** — official surface; Agent Teams still behind experimental flag (API may shift) | Included in Max | **Keep as the core engine** |
| **B. `claude -p` loops (ralph-style)** | ✅ — official CLI on subscription OAuth; since ~2026-06-15 draws from the **programmatic credit pool** ($20/$100/$200 mo at API list rates), not the interactive windows | High: cron-able, loopable, quota-auto-wait patterns exist | Partial: JSON/stream-json logs, status files, tmux monitor; steering only between iterations (`--resume`) | Low-medium — official + officially documented (`setup-token` exists for exactly this); metering can be re-tuned; `--bare` default change will break OAuth-dependent scripts if unpinned | Bounded by credit pool, then Extra Usage | **Adopt for bounded glue** (nightly report, watchdog checks), not the bulk engine |
| **C. Agent SDK + API key** | ❌ on subscription (explicitly disallowed for products; undocumented/unendorsed even privately) — API key required | High | ✅ full programmatic (hooks, `canUseTool`, sessions) | Low with API key (the sanctioned dev path) | Pure API $ — most expensive per token, unbounded | Only if owner accepts API billing; **not now** |
| **D. Cloud Routines (claude.ai scheduled agents)** | ✅ — *requires* subscription login (an exported API key breaks it) | High: cron ≥1h / API-fire / GitHub triggers; fully autonomous, no permission prompts | Low during run (cloud session; results land in repo/PRs) | Medium — research preview, surface may change | Subscription usage + separate daily routine cap | **Adopt as the overnight trigger/watchdog** once stable enough |
| **E. Managed Agents (API service, 2026-04-08)** | ❌ — API billing | High: hosted sessions, cron deployments, outcomes/rubrics | Medium: event streams, webhooks, tool confirmation | Low (Anthropic's strategic bet) | API $ + infra pricing | The "grown-up" endgame if gosleep ever goes API-funded; watch, don't build on |
| **F. Third-party harnesses (Ruflo etc.) on subscription** | ❌ — blocked 2026-01-09 → banned in ToS 2026-02-19 → commercially cut 2026-04-04 | — | — | **Maximal** (account risk) | — | **Never** |

### Recommendation (argued)

**Stay subscription-first on official surfaces; structure gosleep as A + D + B in that order.**

1. **A (tmux + Agent Teams) remains the engine** — it's the only approach that simultaneously (i) runs on the generous interactive quota, (ii) satisfies the owner's supervision requirement (observable panes, steerable lead), and (iii) sits on the exact surface Anthropic has repeatedly protected while cutting everything else off. The Apr-2026 wave *strengthened* this bet ("official Agent Teams… the only fully-supported orchestration option" for Pro/Max).
2. **D (Routines) is the missing overnight piece** — subscription-native, autonomous, cron/GitHub-triggered; use it to kick off or resume the fleet at night and to run watchdog/report jobs, instead of keeping a laptop-bound orchestrator alive. Research-preview status means: wrap it in a thin skill so it's swappable.
3. **B (`claude -p`) for deterministic glue** — headless one-shots (generate report, check CI, triage issue queues) with `--output-format json` + `--max-budget-usd` + strict `--allowedTools`; monitor the programmatic-credit burn via `total_cost_usd`. Pin against the coming `--bare`-default change (bare mode kills OAuth).
4. **Compromise for the owner's fear:** the realistic failure mode is not "Anthropic bans `claude -p`" (they just built a metering system for it — you don't meter what you intend to kill) but "quota/credit gets tighter". Mitigation: design every autonomous loop to degrade to *wait-for-window* (ralph pattern), and keep an `ANTHROPIC_API_KEY` escape-hatch config path (same CLI, one env var) that is OFF by default.

---

## 5. What to adopt in gosleep (ranked)

1. **Ralph's unattended-loop hardening** → port into the orchestrating skill: dual-condition exit gate (heuristics + explicit `EXIT_SIGNAL` block), circuit breaker (no-progress / same-error / permission-denial thresholds + cooldown), **quota auto-wait**, question-detection ("agent asked instead of acting") with corrective re-prompt, control-file protection via granular allowlists.
2. **Gastown's fleet-reliability patterns** → zombie-session detection (tmux alive ≠ Claude alive) for the pulse check; persistent worker identity + ephemeral sessions; convoy-style stall detection for epic-scale runs. (gosleep's Jira+handoffs already play the Beads role — keep that, don't vendor Beads.)
3. **Official Routines (research preview)** → prototype one routine: nightly "wake the fleet / run the queue / file a report" trigger; keep it in a thin skill wrapper pending GA. Locally, evaluate `/loop` + scheduled tasks as the poor-man's version.
4. **`claude setup-token` for CI** → subscription-backed CI checks via `anthropics/claude-code-action`'s `claude_code_oauth_token` input — no API key needed for the repo's future CI gate (GSL has none yet).
5. **Worktree-per-worker isolation** (Claude Squad / gastown hooks pattern) → eliminates the current single-tree contention risks in the fleet.
6. **Budget telemetry** → every headless invocation through one wrapper that logs `total_cost_usd` + session id (stream-json `system/init`), aggregated into the handoff ledger; alert at N% of the monthly programmatic credit.
7. **Policy guardrails file** → encode §2's rules (no OAuth outside official surfaces; no third-party harnesses; API-key hijack check — `unset ANTHROPIC_API_KEY` sanity test in `install.sh`/doctor) so future agents don't wander into banned territory.
8. **Explicitly do NOT adopt:** Ruflo/claude-flow (API-only, hype-heavy, banned-on-subscription category), vibe-kanban (org shut down 2026-04-10), GUI managers (Conductor/Crystal — wrong form factor), TUI-driving hacks à la maestro-p (ToS-adversarial per ralph ADR — and gosleep doesn't need it: Agent Teams is sanctioned).

---

## COVERAGE

- **Covered:** `claude -p`/headless mechanics + flags + auth (official docs, verified via docs-subagent, 2026-07-07); Agent SDK identity/relationship/auth policy; full subscription-policy timeline 2025-07→2026-06 with dated sources and FACT/COMMUNITY-REPORT labels; approach matrix + recommendation; landscape survey (11 tools incl. first-party) with spawn-mechanism source verification for 3 cloned repos; top-3 deep dives; ranked adoption list.
- **NOT covered / caveats:** (1) The primary Help-Center text for the ~2026-06-15 "programmatic credit pool" change was not directly retrievable — fact rests on one detailed secondary guide + ralph's same-dated ADR; re-verify before building billing logic on the exact $ figures. (2) The 2026-04-04 announcement is reconstructed from press (announced via X; no canonical Anthropic page found). (3) No hands-on testing of Routines (research preview) or of `setup-token` in CI. (4) Star counts/claims for Ruflo, ccpm, Mission Control are secondary-source figures, not re-verified. (5) claudefa.st's "Agent Teams is the only fully-supported option" phrasing may overstate — `claude -p` remains documented and metered.
- Clones for future inspection: `.research-cache/{gastown,claude-squad,ralph-claude-code}` (read-only).

### What this means (initial read — to be confirmed against primary sources below)

- **Blocked:** third-party harnesses (OpenClaw, OpenCode, Cline, etc.) authenticating with subscription OAuth tokens; routing "API-shaped" workloads through flat-rate consumer subscriptions.
- **Explicitly still working on subscription:** Claude Code (the official CLI — which includes `claude -p` headless mode), claude.ai, Claude Desktop.
- **Anthropic's stated rationale:** consumer subscriptions are priced for personal conversational + Claude Code use with its prompt-cache optimizations; third-party harnesses bypass those optimizations and consume "outsized" compute at flat-rate pricing.

*(Sections 1, 3–5 below; being filled incrementally.)*

---
