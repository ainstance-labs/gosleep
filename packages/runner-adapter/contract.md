# Runner adapter contract (GSL-281)

`@gosleep/runner-adapter` isolates every provider-specific mechanic behind the
`SessionAdapter` interface. The Claude Code adapter (`claude-code.ts`) is the v1
implementation; this document sketches how a second provider — an OpenAI Codex CLI-style
runner — would slot in without touching `apps/core/`.

The sketch is a REFERENCE, not a promise: the second working adapter is a v2 task per the
GSL-281 non-goal ("Second working adapter — that's a v2 task after the first provider
integration lands"). No code lives in this package for it today.

## The four seams

Every provider must implement four methods. The rules below spell out what each seam MUST
do and where the Claude Code and the hypothetical Codex adapter would diverge.

### 1. `listSessions(opts?): Promise<ListSessionsResult>`

**Contract.** Enumerate the live sessions the provider knows about. Never throws — a
failure returns `ok: false` with a short machine-readable `reason` string
(`"timeout"` / `"exit=N"` / `"parse: …"` / `"spawn: …"` / `"http: rc=…"`).

**Claude Code.** Shells to `claude agents --json`, hard 5-second timeout, parses the JSON
array. Fields consumed: `sessionId`, `name`, `kind`, `pid`, `cwd`, `status`, `startedAt`.

**Codex adapter (sketch).** Would call the runner's REST endpoint (say
`GET http://127.0.0.1:8123/v1/sessions`) with a bearer token from Keychain. Rows would map
`session.id → session_id`, `session.label → name`, and derive `kind` from the runner's
concept of interactive vs batch. `started_at_epoch_ms` from the runner's ISO timestamp.

**Common failure modes.** Both adapters must:
- Set a hard timeout (5 s default).
- Return `ok: false` on ANY error — the fleet-poll worker treats `ok: false` as "skip this
  reconcile tick" so a transient CLI hiccup does NOT set `ended_at` across the whole
  fleet.
- NEVER throw; NEVER leak network / process errors to the caller.

### 2. `installSessionHooks(ctx): Promise<InstallHooksResult>`

**Contract.** Write the provider-specific per-session hook fragments so the control plane
starts intercepting AskUserQuestion and PermissionRequest events for that session.
Idempotent: running twice on the same context is a no-op.

**Claude Code.** Writes `<projectDir>/.claude/settings.json` with three PreToolUse
matchers (`AskUserQuestion`, `PermissionRequest`, `tool-observed`) pointing at the shim
scripts under `tools/hooks/`. Requires the `GOSLEEP_INTERNAL_SECRET` env var to be baked
into the launchd plist for the target session's environment. v1 seed exposes the seam
only; concrete install is owned by GSL-267.

**Codex adapter (sketch).** Would POST to `PUT
http://127.0.0.1:8123/v1/sessions/<id>/hooks` with a JSON body naming the callback URLs
the runner should POST tool-use events to. No filesystem write — the runner keeps its own
config store.

**Common invariants.** Both adapters must:
- Return the absolute path (or the equivalent identifier) of what was written so the caller
  can dashboard it.
- Publish a `hooks` list of matcher names so the caller can render "here's what would
  land" without opening the settings file.
- Fail closed on partial writes (any error → `ok: false`, `reason`). The caller must be
  able to re-run the install to converge.

### 3. `deliverAnswer(input): DeliverAnswerResult`

**Contract.** Push an owner-supplied answer to the paused session. Synchronous by
contract: today's implementation fires an in-process event; future providers may enqueue
an HTTP POST but MUST still return synchronously — the caller does not await network
I/O here.

**Claude Code.** Calls the injected `notify(mutation)` callback, which fires the in-process
`questionNotifier` EventEmitter. That wakes the hook's long-poll GET
`/internal/questions/:qid/answer-wait` (see `apps/core/src/routes/internal.ts`), which in
turn releases the shim's stdout emit → Claude Code injects the answer into the tool call.
Return: `{ ok: true, channel: "in-process-notifier" }`.

**Codex adapter (sketch).** Would enqueue an HTTP POST to
`POST http://127.0.0.1:8123/v1/sessions/<id>/answer` with the payload
`{qid, answer_text, decision}`. Return: `{ ok: true, channel: "http" }`. The POST itself
runs on a background microtask so the caller stays synchronous.

**Common invariants.** Both adapters must:
- Accept the `QuestionMutation` shape (`qid`, `status`, `answer_text`, `answered_at`,
  `answered_by`). Optional `session_id` for providers that route by session, not qid.
- Report the wire used via `channel` so the caller can log which mechanism moved the bit.
- Return `ok: false, channel: "noop"` (with a `reason`) if the adapter was constructed
  without a delivery target — the caller must have a fallback (today: the shim's
  TUI-fallback path, since a missed notify surfaces as a wait-timeout).

### 4. `readTranscript(sessionId): ReadTranscriptResult`

**Contract.** ENRICHMENT-ONLY per rev-3 addendum Delta 3. Enumerate on-disk transcript
files for a session. Never called from the tail indexer or the SSE broadcaster — this
seam is for a lazy, post-hoc enrichment worker that a future task will introduce.

**Claude Code.** Walks `~/.claude/projects/**/{sessionId}*.jsonl`. Returns entries with
`{path, session_id, size_bytes, modified_at_epoch_ms}`.

**Codex adapter (sketch).** Would call `GET
http://127.0.0.1:8123/v1/sessions/<id>/transcript` and materialize the response into a
local cache directory (e.g. `data/transcripts/codex/<sessionId>/*.jsonl`), returning the
cached file paths. The runner's ephemeral transcript storage would still remain the
source of truth; the local cache is the enrichment path's read surface.

**Common invariants.** Both adapters must:
- Never mutate the live control plane state. Read-only side effect at most (a local cache
  write) — no SSE fan-out, no `events` row insert.
- Return `ok: false` with a reason when the transcripts store is missing or unreadable —
  never throw. The enrichment worker treats `ok: false` as "skip this session for now".

## What is NOT abstracted (out of scope for v1 seed)

Per the GSL-281 non-goals:

- **A second working adapter.** This document is a reference; no code.
- **A provider-agnostic event type system.** The `events.src` column stays open-ended per
  rev-2 §4.3 — a Codex adapter would emit `src="codex"` rows without a schema change.
- **A provider-agnostic tool-use hook shape.** Per-provider shim scripts stay bespoke
  (Claude Code has PreToolUse; Codex has its own webhook contract). The adapter surface
  hides the plumbing, not the wire.

## Wire-in checklist for a new adapter

1. Create `packages/runner-adapter/src/<provider>.ts` that exports a
   `create<Provider>Adapter(opts): SessionAdapter` factory.
2. Re-export the factory from `packages/runner-adapter/src/index.ts`.
3. In `apps/core/src/adapter/session.ts`, gate the choice of adapter behind an env or
   config flag (`GOSLEEP_RUNNER_PROVIDER=codex` → the new factory).
4. Add a unit test file that pins down the four seams' contracts against the new
   implementation.
5. Update this document with the new adapter's per-seam notes.

No changes to `apps/core/src/routes/*.ts`, `apps/core/src/workers/*.ts`, or the SQLite
schema are required — the seam is complete when the new adapter compiles + passes the
adapter tests.
