# GSL-281 [Repo][Web] SessionAdapter interface seed

**Date:** 2026-08-07 (shift 75 / cycle 209 impl-web-12, autonomous night)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin)

## Part 1 — the story

The rev-3 addendum called this out as **Delta 10**: owner requirement R7
("Future-proofing: providers other than Claude Code later") had no seam in rev-2 — every
Claude Code specific was baked into `apps/core/`. Coverage gap **G11**
(`docs/reports/web-stack-audit-2026-08-06/coverage.md` §7) put a number on the same
problem. GSL-276 built the fleet-poll worker; it already imported through
`@gosleep/runner-adapter#listClaudeAgents`, but the SEAM was a single function — no
interface, no contract, no other seams named. This task formalises the interface across
all four seams the addendum mentioned, and moves the existing call-sites through it.

The four seams landed as `SessionAdapter` in
`packages/runner-adapter/src/session-adapter.ts`:

1. `listSessions()` — enumerate live sessions. The v1 Claude Code adapter wraps the
   existing CLI call; the interface returns `SessionSummary[]` so a Codex-style adapter
   could produce the same shape from an HTTP endpoint.
2. `installSessionHooks(ctx)` — write per-session settings fragments. The v1 seed
   exposes `settingsPath` + a `hooks` matcher list but returns `ok: false` with a reason
   naming GSL-267 as the concrete install owner (per the Jira scope's "Import through
   the adapter file even where there's only one implementation — the seam must be
   alive.").
3. `deliverAnswer(input)` — the mechanism that reaches the paused session. For Claude
   Code that's the in-process `questionNotifier` (which wakes the hook long-poll
   `GET /internal/questions/:qid/answer-wait`). The adapter takes `notify: (m) => ...`
   at construction time so the wire stays test-injectable; production wires it in
   `apps/core/src/adapter/session.ts`.
4. `readTranscript(sessionId)` — enumerate on-disk transcripts. ENRICHMENT-ONLY per
   rev-3 addendum Delta 3. For Claude Code that walks `<transcriptsRoot>/**/*.jsonl`
   and returns entries whose filename contains the session id. The tail indexer NEVER
   calls this — the transcripts are for a future post-hoc enrichment worker.

The **migration bit** was mostly plumbing:
- New `apps/core/src/adapter/session.ts` — cached singleton adapter, constructed with
  `notify: (m) => questionNotifier.notify(m)`.
- `apps/core/src/workers/fleet-poll.ts` — the `claudeBin?` test hook is gone; the new
  `adapter?: SessionAdapter` option lets tests inject a fake without touching the CLI.
  `reconcileRoster` typed on `SessionSummary[]` (was `ClaudeAgent[]`, which is now a
  type alias).
- `apps/core/src/routes/actions.ts` — three `questionNotifier.notify(...)` call-sites
  (doAnswer, doResolve, doApplyManifest) rewritten to `getSessionAdapter().deliverAnswer(...)`.
  Same payload; the seam is what changed.

**Comment sweep.** The GSL-281 acceptance rule reads: "apps/core/src/** has no direct
references to `claude agents`, `~/.claude/`, or `.claude/settings.json` file writes —
only via the adapter." Comments count. Six files touched:
`db/schema.ts`, `indexer/tail.ts`, `indexer/process.ts`, `serve.ts`,
`questions/notifier.ts`, `workers/fleet-poll.ts`. Post-sweep tripwire:
`grep -R 'claude agents' apps/core/src` → 0 hits. `grep -R '~/.claude/\|.claude/settings' apps/core/src` → 0 hits.

**The contract sketch** (`packages/runner-adapter/contract.md`) lays out how an
OpenAI/Codex-style adapter would slot in: `listSessions` calls the runner's REST
endpoint, `deliverAnswer` POSTs a callback URL, `installSessionHooks` PUTs a config on
the runner, `readTranscript` caches into `data/transcripts/codex/`. No code — the second
provider is a v2 task per the Jira non-goal, and this document is the reference for it.

**What hurt.** Nothing severe. The adapter's `deliverAnswer` is delegation-by-callback,
not delegation-by-interface, because moving the `questionNotifier` singleton into the
adapter package would have coupled `packages/runner-adapter` to
`apps/core/src/questions/*`. The current shape keeps the adapter runtime-agnostic (it
only knows about a `notify` closure), and the injection lives in one place.

**Known smoke failures** (pre-existing, not caused by this task): `smoke.sh` reports 2
FAILs — "digest has 0/7 sections" and "digest hides its staleness" — around line 1300
of the smoke, in the chronicler morning-digest generation. Reproduced on the pristine
tree without any of this task's changes (verified). Not the flake at :237 the brief
called out; separate morning-digest issue that predates this shift.

## Part 2 — technical reference

### Package shape

```
packages/runner-adapter/
├── contract.md                       # OpenAI/Codex adapter sketch (v2 reference)
├── package.json                      # bumped to 0.1.0; description rewritten
├── src/
│   ├── claude-code.ts                # createClaudeCodeAdapter + listClaudeAgents (low-level)
│   ├── index.ts                      # re-export the four seams + adapter factory
│   └── session-adapter.ts            # SessionAdapter interface + types
├── test/
│   └── adapter.test.ts               # 9 tests / 33 expects, 4-seam coverage
└── tsconfig.json                     # `include` now covers src/ + test/
```

### apps/core/ changes

```
apps/core/src/adapter/session.ts      # NEW — getSessionAdapter() singleton
apps/core/src/workers/fleet-poll.ts   # migrated to SessionAdapter.listSessions
apps/core/src/routes/actions.ts       # migrated to SessionAdapter.deliverAnswer
apps/core/src/{db/schema,indexer/tail,indexer/process,serve,questions/notifier}.ts
                                      # comments rewritten to name the adapter seams
apps/core/test/fleet.poll.test.ts     # imports SessionSummary; canned lister unchanged
```

### Gates

- `bun x tsc -p packages/runner-adapter --noEmit` — clean.
- `bun x tsc -p apps/core --noEmit` — clean.
- `bun x tsc -p packages/schema --noEmit`, `packages/sdk --noEmit`,
  `apps/web --noEmit` — all clean.
- `packages/runner-adapter/test/adapter.test.ts` — 9 pass / 33 expects.
- `apps/core` `bun test` — 102 pass / 382 expects.
- `bash tools/lab/tests/core-smoke.sh` — 55 / 55 PASS (proves the migrated actions.ts
  still delivers answers end-to-end).
- `bash tools/lab/smoke.sh` — 549 / 551 (2 pre-existing FAILs unrelated to this task,
  verified against pristine tree).

### Acceptance tripwires (from Jira)

- `grep -R 'claude agents' apps/core/src` → 0 hits.
- `grep -R '~/.claude/\|.claude/settings' apps/core/src` → 0 hits.
- `packages/runner-adapter/` exists as a Bun-workspace package (unchanged from GSL-276).
- `contract.md` sketches the OpenAI/Codex-side implementation as a reference (no code).
