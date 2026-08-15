# GSL-325 · phase 7 · Fleet model boot-window race → unknown, not settings fallback

## What was done

Follow-up on **GSL-321** (`d58ac8c`). GSL-321 made the Fleet Model column read the
session's real model transcript-first, so a delegated `claude --model haiku` no longer
rendered as the global `claude-fable-5[1m]`. Run 07 (independent verification of the
run-06 hotfix bundle) found ONE remaining MAJOR bug — a boot-window race:

- `resolveTranscriptModel(sid, opts)` returned `null` in **two** cases: (a) no transcript
  file for this session_id exists at all; (b) a transcript file EXISTS but no assistant
  line has landed yet (the session is booting / mid-first-turn).
- `modelCache.get()` fell back to the settings-hierarchy resolver in **both** cases.
- Consequence: a delegated `claude --model sonnet` session showed the WRONG global default
  (`claude-fable-5[1m]`) for the first several seconds — until its first assistant turn
  landed. Asymptotically self-correcting, but the boot window shipped a fabricated value.
  That violates GSL-321's own design intent ("show 'unknown' rather than a wrong-but-
  confident value") — the initial commit honored the intent only for case (a).

### Fix (surgical, on GSL-321's code path)

`apps/core/src/adapter/model-resolver.ts`:

- New discriminated return `TranscriptModelState = { kind:"found", model } |
  { kind:"starting" } | { kind:"absent" }` and a new reader
  `readTranscriptModelState(sessionId, opts)`.
  - **`found`** = an assistant `message.model` line was scanned in the newest transcript
    file.
  - **`starting`** = at least one transcript file matches this session_id, but no
    assistant-model line was found (empty file, only user turns, or every candidate was
    unreadable).
  - **`absent`** = no transcript file at all matches this session_id.
- `modelCache.get(session_id, cwd, opts)`:
  - `found` → cache and return `state.model`.
  - `starting` → cache and return `null`. **DO NOT fall back to the settings hierarchy** —
    that is the boot-window fix. Fleet renders "model unknown".
  - `absent` → run `resolveModelForCwd(cwd, opts)` (unchanged behavior — the shared/global
    default is the honest fallback when the session was just started and nothing is
    journaled yet).
- Public `resolveTranscriptModel(sid, opts): string | null` is retained as a thin wrapper
  around `readTranscriptModelState`, so the 12 existing GSL-321 unit tests stay green.

### Regression tests

`apps/core/test/transcript-model.test.ts` — 8 new tests:

- 5 direct on `readTranscriptModelState`: empty session id → `absent`; empty listing →
  `absent`; assistant line → `found`; user-only file → `starting`; unreadable file →
  `starting` (NOT absent — the session is journaled, so no settings fallback).
- 3 on `modelCache` composition: transcript with user-only turn + wrong-but-confident
  settings default → `null` (Fleet shows unknown, NOT fable-5); empty transcript file →
  `null`; unreadable transcript file → `null`.

## Gates

- `bunx tsc -p apps/core --noEmit` — clean.
- `bunx tsc -p apps/web --noEmit` — clean.
- `bun test apps/core` — **268/268 pass** (was 260 before this task; +8 new).
- `bash tools/lab/tests/core-smoke.sh` — **102/102 pass**.
- `bun run --filter='@gosleep/web' build` — clean.

## Live proof

`.artifacts/gsl-325/boot-window-proof.ts` — bun script that creates a real
`$HOME/.claude/settings.json` (declares `claude-fable-5` as the global default) and a
real Claude-Code-shaped transcript file in a tempdir, then exercises the production
`modelCache.get()` (no test seams beyond the transcript-listing hook). Four phases run
against real files:

| Phase | Transcript state                        | `modelCache.get()`             | Fleet pill                        |
|-------|-----------------------------------------|--------------------------------|-----------------------------------|
| 1     | Boot window — file exists, user turn only | `null`                         | `model unknown`                   |
| 2     | Post-boot — assistant turn appended     | `claude-sonnet-4-5-20250929`   | `claude-sonnet-4-5-20250929`      |
| 3     | Absent — transcript file removed        | `claude-fable-5` (settings)    | `claude-fable-5`                  |
| 4     | Empty file (just spawned)               | `null`                         | `model unknown`                   |

All four phases pass. Output archived at `.artifacts/gsl-325/proof-output.log`. Before
GSL-325, Phase 1 and Phase 4 would have returned `claude-fable-5` — exactly what run 07
caught.

Visual proof: scratch core booted on `127.0.0.1:7350` with a hermetic DB under
`.artifacts/gsl-325/scratch/gosleep.db`, three seeded `agent_sessions` rows exercising
the states above (fleet-poll disabled so the seed stays put). Screenshots archived at
`.artifacts/gsl-325/`:

- `fleet-after-fix.png` — boot-window row shows **"model unknown"**, post-boot row shows
  **claude-sonnet-4-5-20250929**, and a contrast row explicitly labelled
  `PRE-FIX-race-shown-for-contrast-only` shows the wrong-but-confident `claude-fable-5`
  the pre-fix code would have leaked into the boot-window row.
- `fleet-post-boot-transition.png` — same page after the boot-window row's model was
  updated to the real model (simulating what fleet-poll does on the next tick once
  the assistant line lands); the row now shows `claude-sonnet-4-5-20250929`.

Scratch core teardown: PID killed, port 7350 free.

## Follow-ups

None from this task. GSL-321 stays In Review; when a closer merges PR #324 the two land
together on `GSL-318-run06-fixes`.

## Files touched

- `apps/core/src/adapter/model-resolver.ts` — discriminated state + modelCache rewrite.
- `apps/core/test/transcript-model.test.ts` — 8 new regression tests.
- `docs/dev_history/GSL-325-phase7-fleet-model-boot-window-race.md` — this file.
- `docs/dev_history/README.md` — index entry.
