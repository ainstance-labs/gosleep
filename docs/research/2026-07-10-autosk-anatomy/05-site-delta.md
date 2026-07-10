# AutoSK site re-fetch & delta (GSL-63, GH #72)

**Sources:** live https://autosk.app/ (WebFetch 2026-07-10) · GitHub API `repos/wierdbytes/autosk` (live) · clone `.research-cache/autosk` @ `fd4c22e` (v0.2.4) · baseline: `docs/research/2026-07-07-orchestration/01-autosk.md` §1/§7
**Date:** 2026-07-10 · **Researcher:** res-anatomy

---

## 1. Headline result: zero delta — the project is frozen

The baseline (01-autosk.md:235) flagged that the live site had never been re-fetched and was assumed to match the repo's `website/` source. Verified now, and stronger than expected:

- **The live repo has had NO commits since the clone.** `fd4c22e` ("release v0.2.4", 2026-06-28T14:45Z) is still HEAD; `pushed_at` = 2026-06-28T14:46:38Z (GitHub API). **12 days of total silence** — no commits, no releases, no site edits.
- **Latest release is still v0.2.4** (2026-06-28); previous cadence was rapid (v0.2.2 → 06-24, v0.2.3 → 06-24, v0.2.4 → 06-28).
- **Adoption flat:** 27 stars, 5 forks, 8 open issues/PRs — byte-identical to the 07-07 baseline (01-autosk.md:15).
- **Live copy == clone source.** Live hero "You don't need a smarter agent. You need a way to run them in loops." = `website/src/components/Hero.astro:20-21`; "…a real pipeline you can watch, steer, and trust" = `Hero.astro:25` (the exact line 01 cited from source); eyebrow "task manager + workflow engine for coding agents" = `Hero.astro:16`; meta description = `website/src/layouts/Base.astro:12`.

**Conclusion:** all §7 claimed-vs-implemented analysis in 01-autosk.md remains valid against the live site; nothing was re-positioned in the interim.

## 2. What the site declares today (full inventory, one-pager)

Single page, anchor nav only (`#features`, `#how-it-works`, `#install`) — **no subpages**. External links: GitHub repo, `docs/` tree (concepts, workflows, daemon, extensions, lazy), releases, CHANGELOG, MIT license, iOS TestFlight (`testflight.apple.com/join/jYDpqT2v`). Section → source component map (`website/src/components/`):

| Live section | Component | Key claims (verbatim fragments) |
|---|---|---|
| Hero | `Hero.astro` | "task manager + workflow engine for coding agents"; "run them in loops" |
| Problem | `Problem.astro` | "One chat window is not a process" — no handoffs / no guardrails / no memory |
| Model | `SolutionModel.astro` | tasks → workflows-as-code → daemon-driven agents; `feature-dev: dev → review → docs → validator → accept → cleanup → done` |
| Feature grid | `FeatureGrid.astro` | "Workflows as code, not config"; "Multi-agent handoffs"; "Guardrails that stop loops" (`step_visits` caps → park to human); "Never lose work" (interrupted → `human`); "Agent-owned sandboxes" (worktree/Docker); "No database — just files"; "Three front ends, one source of truth"; "Bring your own agent" (Claude Code + pi drivers); "Extensions, no build step" |
| Deep dives | `DeepDive.astro`/`DeepDives.astro` | expanded feature walk-throughs (not covered in 01; content mirrors README) |
| 30 seconds | `HowItWorks.astro` | `autosk create` → `autosk enroll` → `autosk lazy` |
| Why autosk | `Comparison.astro` | vs raw agent: pipeline/parallelism/persistent transcripts; vs Jira/Linear: "process in code, not config UI" |
| Trust band | `TrustBand.astro` | "Parks, never crashes"; local, MIT, signed+notarized cask, Linux binaries, iOS TestFlight |
| Final CTA | `FinalCTA.astro` | iOS = "companion to the daemon" (remote-only, per 01 §6) |

No pricing, no waitlist, no roadmap, no version numbers anywhere on the page — same modest, honest positioning 01 §7 described. Marketing still stops short of "sleep while it works" autonomy: "loops" framing = the bounded pipeline loops of §7, not overnight scheduling.

## 3. Roadmap hints

**None on the site.** The only forward-looking signals anywhere in the live artifacts:
- 6 open community PRs from a single outside contributor sit unreviewed since 2026-06-02 (see `04-unmerged-prs.md`) — the author neither merged nor closed them, consistent with a paused project rather than a rejected direction.
- Last real feature before the freeze: GUI transcript folding (`55187d3` feat(gui): collapsible thinking & tool blocks, 2026-06-28) — polish work, not new capability.

## 4. Implications for gosleep

1. **Bus-factor-1 risk materialized on schedule.** 01 §8.8 warned "solo author, will do a clean break again"; reality is even simpler — a 6.5-week burst then 12 days of silence. Treat autosk as a **frozen reference architecture to mine, not a dependency or a moving competitor**.
2. **The competitive gaps identified in 01 §9 are all still open** (usage-window-aware scheduling, push-on-park, session resume, TLS/tunnel remote). Nobody is closing them from the autosk side.
3. **The "run them in loops" pitch line is the market framing gosleep competes in** — autosk sells bounded in-repo loops; gosleep's differentiator remains the time dimension (overnight, usage-window-aware, owner-asleep) which the site still doesn't even gesture at.

## COVERAGE

**Covered:** live autosk.app full-page inventory (hero, all sections, links, install); live-vs-source verification (3 verbatim anchors); repo liveness via GitHub API (commits since clone, releases, stars/forks/issues); roadmap-hint sweep. Site is a one-pager — no subpages existed to fetch.
**Not covered:** rendered-DOM diff (fetch is markdown-converted; pixel/JS-level changes invisible — irrelevant for a static Astro page); Wayback history of the page between 06-28 and today (low value given repo freeze); TestFlight build metadata (requires device).
**Confidence:** high — every delta claim is anchored to live API data or verbatim source lines.
