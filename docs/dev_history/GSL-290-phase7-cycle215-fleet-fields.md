# GSL-290 [Repo][Web] Fleet — model resolved, unknown fields rendered honestly

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-276 (agent_sessions), GSL-281 (SessionAdapter).

## Part 1 — the story

The verifier audit showed every live session's `model`, `context_pct`, `current_intent`
came back NULL from `/fleet`. The Fleet screen then rendered blank fields — an owner
opening it couldn't answer "which model, at what context %, doing what" for any session.

The `claude agents --json` CLI doesn't carry those fields (documented in
`packages/runner-adapter/src/claude-code.ts` header). Two independent lanes fill them:

- **model** — the CLI omits it, but the Claude Code binary itself reads a settings
  hierarchy (`<cwd>/.claude/settings.local.json` → `<cwd>/.claude/settings.json` →
  `$HOME/.claude/settings.json`) on launch. This ticket adds a resolver that walks the
  same hierarchy for each `agent_sessions.cwd` at fleet-poll time and stamps the model
  via `COALESCE(?, model)` — so a mid-day config edit picks up on the next tick, but
  a temporary read failure never clobbers a previously-good value.
- **context_pct + current_intent** — these come from the `POST /internal/agents/tool-observed`
  path fed by the PreToolUse{tool-observed} shim (see runbook § 8). The shim is future
  work; the endpoint is already live. Rather than fabricate data, the Fleet UI now
  renders an explicit `unknown` pill with a tooltip naming the shim as the fix, so an
  operator reading a blank card knows exactly what to install.

Fleet card polish: the model pill always renders now (either the resolved model or
`model unknown` with a tooltip explaining where the resolver looked). The Intent block
always renders (either the observed intent or `unknown` with the tooltip). Blanks
disappear — every cell is a positive statement.

## Part 2 — the reference

- **Commit:** GSL-290 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/core/src/adapter/model-resolver.ts` — NEW. `resolveModelForCwd()` (pure) +
    `modelCache` (per-tick LRU keyed on `cwd|home`). Reads top-level `"model"` first,
    then `env.CLAUDE_MODEL`, then `env.ANTHROPIC_MODEL`. Malformed JSON at any tier is
    skipped, not fatal.
  - `apps/core/src/workers/fleet-poll.ts` — call `modelCache.startTick()` at the top of
    every reconcile; pass `modelCache.get(a.cwd)` into INSERT (fresh row) and into
    UPDATE via `model = COALESCE(?, model)` (keep the stale value if the resolver
    momentarily returns null; overwrite when a fresh non-null value shows up).
  - `apps/web/src/screens/Fleet.tsx` — model pill always renders (`model unknown` with
    tooltip when null); Intent block always renders (`unknown` with tooltip when null).
  - `apps/core/test/model-resolver.test.ts` — NEW. 13 unit tests: precedence order,
    top-level wins over env, env fallback chain, malformed JSON tolerance, empty-string
    treated as absent, per-tick cache behaviour, cwd-key isolation.
  - `apps/core/test/fleet.poll.test.ts` — updated `model` assertion + header comment to
    document that model is now best-effort resolved (`row.model === null || typeof
    row.model === "string"` instead of a strict null assertion, which is now flaky on any
    machine with `~/.claude/settings.json`).
- **Verified by running:**
  - `bun test apps/core/test/model-resolver.test.ts` → 13/13.
  - `bun test apps/core` → **175 pass, 0 fail** (all suites).
  - `bun x tsc -p apps/core --noEmit` + `bun x tsc -p apps/web --noEmit` → clean.
  - `bash tools/lab/tests/core-smoke.sh` → 78 pass (unchanged).
  - Live end-to-end: seeded scratch DB + two synthesised sessions —
    `/tmp/gsl290-scratch/fake-cwd` with a `settings.local.json {"model": "claude-opus-4-7-scratch-marker"}`
    and `/nonexistent-cwd-12345`. After `reconcileRoster`:
      - `with-settings.model = "claude-opus-4-7-scratch-marker"` (from the fake cwd's
        settings).
      - `no-settings.model = "claude-fable-5[1m]"` (fell through to `~/.claude/settings.json`
        on the dev machine).
    Both `context_pct` and `current_intent` stayed null as expected (shim not installed).
  - `apps/web/dist` rebuilt to bake the Fleet UI change into `/` served by core.
- **Links:** Jira [GSL-290](https://ainstance-labs.atlassian.net/browse/GSL-290),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
