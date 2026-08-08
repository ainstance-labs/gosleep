# target-architecture — revision 3 addendum (deltas only)

**Author:** worker `web-setup`, shift 75 of gosleep, cycle 195.
**Date:** 2026-08-07.
**Object of delta:** `docs/reports/web-harness-research-2026-08-03/target-architecture.md`
(revision 2, 974 lines, agreed 2026-08-03).
**Language:** English.
**Not committed as an edit to rev 2.** This is an additive addendum — rev 2 stands as written except where an item below explicitly replaces a paragraph.

## Source of these deltas

- Stack audit `docs/reports/web-stack-audit-2026-08-06/` — five reports (`stack.md`, `integration.md`, `coverage.md`, `verify-core.md`, `verify-claims.md`).
- Fable-final adjudication `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md` — the authoritative pass where reports conflicted. Its § references are cited by number below.
- Owner requirements as restated on 2026-08-06 (`d-2026-08-03-007`, expanded in `coverage.md` section 2).

Where an item cites `fable-final §N` or `coverage.md §N.G_i`, that is the paragraph of record — this addendum only relays the decision.

---

## Delta 1 — v1 answer-delivery loop (replaces rev 2 §3.3 `spawn/` and rev 2 §5.3 rule 3; refines §6.2 answer row)

**Replaces:** the implicit "answer reaches the agent on its next voluntary state read" that rev 2 inherited from today's `lab-emit answer` habit (`coverage.md` §4 documents the gap end-to-end).

**Mechanism (v1).** Every supervised session gets a `PreToolUse{matcher: "AskUserQuestion"}` command hook wired in the session's `.claude/settings.json`. On every AskUserQuestion tool call:

1. The hook POSTs the full `tool_input` (`{questions[]}`) to `gosleep-core` at `POST /internal/questions/post` (127.0.0.1, env-secret).
2. Core stores the row (with the manifest lookup from Delta 8 running immediately), then the hook **long-polls** core at `GET /internal/questions/<qid>/wait` with hook `timeout` set to a bounded window. **Default 600 seconds** (matching the official command-hook default per `code.claude.com/docs/en/hooks.md:415`), configurable per session in `.claude/settings.json`, **no ceiling documented** — the design assumes 900–1800 s in production and does not attempt "all night" holds (`fable-final §1(b)`).
3. **Answer arrives in-window** (owner clicked in web UI, or the decision-manifest rule auto-matched):
   - **Primary path** (subject to the GSL-274 smoke-test result): hook returns `{permissionDecision: "allow", updatedInput: {questions: <echoed>, answers: <map<questionText,label>>}}`. Documented at `hooks.md:1643, 1688`; sets the `answers` field that Claude does not set itself. Tool completes as answered, TUI never prompts, agent proceeds.
   - **Documented fallback** (kept as a production-safe alternative even if the primary path validates): hook returns `{permissionDecision: "deny", permissionDecisionReason: "OWNER ANSWERED: <label>"}`. Reason text is passed to the model per `hooks.md:1664`; the agent reads the owner's answer as the denial reason and proceeds. Semantically lossier (deny vs allow) but fully documented in interactive mode.
4. **Timeout / no answer:** hook exits 0 with no output. Per `hooks.md:223`, "Exit code 0 with no output means the hook has no decision to report, so the tool call continues through the normal permission flow." → the AskUserQuestion dialog **renders in the TUI as normal**; session is neither killed nor errored. The web UI flags the question `TUI-local` — late arrival can still be resolved via the free-text send-keys path (never the arrow selector).
5. **Permission prompts** (the other blocking state): the same blocking-wait pattern is applied on `PreToolUse` matchers for `PermissionRequest`, returning `{permissionDecision: "allow" | "deny"}`. Documented allow/deny; `PermissionDenied{retry: true}` is the auto-mode variant.

**`defer` DROPPED.** Rev 2 briefly considered a defer-then-resume path; `fable-final §1(a)` establishes that `permissionDecision: "defer"` is **print-mode only** — `hooks.md:1698` verbatim: "Claude Code honors this value only in non-interactive mode with the `-p` flag. In interactive sessions it logs a warning and ignores the hook result." Confirmed at runtime by strings-dump of installed CLI 2.1.224: `"returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)"`. Do not build against defer for the interactive fleet.

**Impact on the pipeline.** The `spawn/` folder in rev 2 §3.3 gains no new spawner (this is a hook, not a CLI spawn). What changes:

- `apps/core/src/routes/internal.ts` — new module handling `POST /internal/questions/post` and `GET /internal/questions/<qid>/wait` (SSE or long-poll; long-poll is the simpler v1 shape and matches the hook contract).
- `apps/core/src/db/schema.ts` — `questions` gains the manifest columns from Delta 8; `wait_expires_at` (informational).
- `.claude/settings.json` hooks stanza — one new `PreToolUse` matcher per session template, sibling to the existing `lab-log-hook`. Managed by GSL-267's shim.

**Blocks / gates:** the entire loop is gated on **GSL-274** (30-min smoke), the linchpin de-risking test filed as the first executable task of the epic.

**References:** `coverage.md` §4 (gap statement); `fable-final §1(a-d)`, §6 (verdict table rows for the two hook events).

---

## Delta 2 — Channels rescoped to v1.1 (replaces rev 2 §7.1 industry-row "Warren" implication and rev 2 §12 non-goals)

**Replaces:** the implicit "channels can carry the question/answer pair in v1" that survived into `integration.md`.

**Decision:** channels are a **v1.1** integration only, and scoped to what they actually cover.

- **Documented substance kept:** channels can be two-way (Claude reads and replies through the same MCP reply tool); the permission-relay capability `claude/channel/permission` is fully specified (`notifications/claude/channel/permission_request` in → `notifications/claude/channel/permission` out with `{behavior: allow|deny}`; local dialog stays open, first answer wins) — this is what `integration.md` row 3f described correctly.
- **Substance NOT in scope for v1.1:** the relay covers **tool-use approvals only** (`Bash`, `Write`, `Edit`). It does **not** relay AskUserQuestion dialogs, project-trust dialogs, or MCP-consent dialogs. **Channels are never the answer-delivery path for questions** — Delta 1's hook is.
- **Preview reality:** during the research preview, `--channels` only accepts the Anthropic-curated allowlist; a self-published channel needs `--dangerously-load-development-channels`, which triggers a **full-screen consent dialog at every session start** (`fable-final §2`). This is honest friction for an orchestrator-spawned fleet.
- **Subscription viability confirmed:** Pro/Max individual accounts (i.e. this owner's contour) skip the org gating; opt in per session with `--channels`. Settles the open question rev 2 §7.1 left in the industry table.
- **v1.1 scope:** gosleep-as-channel is a plugin that adds (a) phone-side permission relay for `PermissionRequest` (in addition to the hook path from Delta 1), and (b) owner-steer messages delivered at **turn boundaries** (channel events queue into the session and deliver together on the next turn per `channels-reference.md` — no mid-turn interception).

**Impact on rev 2 §12 non-goals:** move "channel plugin" from "considered" to "v1.1 explicit, dev-flag gated". No v1 code touches channels.

**References:** `fable-final §2`; `coverage.md` §4 quote on why channels cannot be the mid-turn unblock path.

---

## Delta 3 — Transcript tail = history enrichment only (refines rev 2 §5.3 rule 3 and §12 R26 wording)

**Replaces:** any read path in rev 2 that would rely on the transcript JSONL as a live signal.

`sessions.md` (fetched 2026-08-07) verbatim: "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release." (`fable-final §4` quick-confirmation.)

Consequence for gosleep-core:

- **Live signal** = hooks (dual-write into SQLite via `POST /internal/emit` per Delta 1's cousin path GSL-267). Never the transcript.
- **Enrichment** = post-hoc reading of session transcript files (`~/.claude/sessions/…`) as an OPTIONAL context layer for the fleet screen (Delta 8) — behind an integrity fence (schema-version probe on first line + `try/catch`-around every parse) so a Claude Code release cannot brick the panel.
- **CI/smoke guard:** `apps/core/src/session/transcript-tail.ts` must be marked `// enrichment only — format internal, may break on release` with a lint rule forbidding it from being imported by any live-signal module.

**Impact:** none on tasks — a comment note goes on GSL-263 (indexer + SSE) to keep the transcript out of the tail path.

**References:** `fable-final §4`; `sessions.md` (external).

---

## Delta 4 — TouchID gate = signed `.app` bundle (replaces rev 2 §3.3 `bin/touchid-gate` line and rev 2 §7.3 "Приоритет 1")

**Replaces:** the rev 2 statement "Swift-бинарь, скомпилирован swiftc" for the TouchID gate.

**Ground truth:** the sameh0/op-gate README verbatim: "a signed macOS `.app` bundle (required for biometric entitlements)." Bare Mach-O executables built by `swiftc` do **not** receive `LocalAuthentication` biometric entitlements — the `com.apple.developer.local-authentication.private-persistent-key`-adjacent entitlements are gated on a bundle identity.

**Required shape for `bin/touchid-gate`:**

1. Xcode-less Swift build of a tiny AppKit `LAContext` shim (`Sources/TouchIDGate/main.swift`).
2. Wrapped into a `bin/touchid-gate.app/` bundle with `Contents/MacOS/touchid-gate`, `Contents/Info.plist` (declaring `LSUIElement=true` so no Dock icon), and `Contents/embedded.provisionprofile` OR ad-hoc codesigned via `codesign -s - --entitlements Sources/TouchIDGate/entitlements.plist --deep --force`.
3. `apps/core/src/spawn/publish.ts` invokes `open -W -a bin/touchid-gate.app` and reads the exit code (`0` = granted, `1` = denied, `2` = no sensor → falls back to TTY-confirm per rev 2 §7.3).
4. `apps/core/install-deps.sh` is extended to build and sign the .app bundle in place — no external Xcode dependency; owner's macOS ships the toolchain.

**Impact on tasks:** GSL-264 (Security) gains this as a scope note. The line "swiftc -framework LocalAuthentication -framework Security" in rev 2 §9 step 3 is superseded here.

**References:** `fable-final §4` (TouchID row); `verify-claims.md` §5; op-gate README (external).

---

## Delta 5 — Keychain hardening (adds to rev 2 §7.2 row 2 and §7.4 wrapper description)

**Replaces:** the rev 2 note "wrapper при timeout возвращает 503" with the fuller policy set below.

**Additions to `apps/core/src/security/keychain.ts`:**

1. **ACL binding:** the Bearer secret is stored via `security add-generic-password -T /path/to/apps/core-binary -T /path/to/scripts/plist.sh -A -s gosleep-web -a $USER -w <secret>` — the `-T` flags restrict which binaries can retrieve the item without user consent per session. `-A` **must NOT be used** in production; the trusted-app list is the whole point.
2. **Timeout policy:** the wrapper caps each `security find-generic-password` call at **5 seconds** (`spawn` with `timeout` option). On timeout → return `503 Service Unavailable` to the caller; **never** silently fall back to unauth (this is exactly the gh CLI regression, `github.com/cli/cli/issues/13317`, we explicitly avoid).
3. **Tahoe 26.x regression acknowledgment:** per `fable-final §4` (Tahoe row), the `security -w` CLI on macOS Tahoe 26.x is known to hang and to HEX-encode binary passwords (`dev.to/euda1mon1a`, `zenn.dev/omori432`). The wrapper detects `sw_vers -productVersion` on start; on 26.x it (a) sets the timeout floor to 5 s regardless of override, and (b) writes/reads secrets ASCII-only (Base64-encoded shim) to avoid the HEX-encoding regression. If encoding integrity fails at read time → 503 + log line.
4. **Per-boot auth-source audit line:** on `apps/core` startup after a fresh boot (detected via uptime < 5 min at process start), the daemon logs one audit line: `auth-source: keychain (acl=ok) | fallback: none` (or the concrete failure). Line is also written as an `events` row with `type='security.auth-source-audit'` so the web timeline shows it. This proves to the owner the auth source is really Keychain (and not a plaintext fallback that slipped in during dev).

**Impact on tasks:** GSL-264 (Security) gains these five items in its acceptance criteria (via comment).

**References:** `fable-final §4` (Tahoe row); rev 2 §7.2 row 2, §7.5 first bullet; `github.com/cli/cli/issues/13317`.

---

## Delta 6 — Vite 6 → Vite 7 (replaces the version pin in rev 2 §1 one-page table, §3.1 industry table, §5.1, §5.2, §6.0, §9 step 6, App-A)

**Replaces:** every mention of "Vite 6" in rev 2.

**Decision:** the client pins **Vite 7**. Vite 8 (released 2026-03-12 with Rolldown as default bundler per `vite.dev/blog/announcing-vite8`) is **deferred to v1.1** — the official staged path is `rolldown-vite` on Vite 7 first. Warren itself is Vite 6, but we intentionally leapfrog (both reports agreed this divergence is safe).

- `apps/web/package.json` → `"vite": "^7.0.0"`, `"@vitejs/plugin-react": "^5.0.0"`.
- The rest of the client stack in rev 2 §6 stays as written.

**Impact on tasks:** GSL-265 (client skeleton) gains this pin (via comment).

**References:** `fable-final §4` (Vite row); `stack.md`; `vite.dev` release blog.

---

## Delta 7 — `/metrics` endpoint (extends rev 2 §3.3 `routes/read.ts` list)

**Adds:** `GET /metrics` alongside the existing Read endpoints.

- Format: **Prometheus text exposition** (`text/plain; version=0.0.4`).
- Auth: Bearer required (same layer as other reads; no separate metrics token).
- Content (v1): `gosleep_core_uptime_seconds`, `gosleep_events_ingested_total{src}`, `gosleep_sse_subscribers`, `gosleep_hook_wait_seconds_bucket{le,event}` (histogram for the answer-loop hook wait times from Delta 1), `gosleep_questions_open{kind}`, `gosleep_security_auth_source{source}` (gauge 0/1 per source label — feeds the audit assertion from Delta 5), `gosleep_agents_context_pct{session}` (gauge from Delta 8 fleet table).
- Not designed for external Prometheus scrape; local `curl 127.0.0.1:7331/metrics` + optional `promtail` sidecar for owner-side dashboards.
- Storage rate: no separate storage — computed on request from the existing tables and in-process counters.

**Impact on tasks:** GSL-263 (indexer + SSE + read endpoints) gains `/metrics` in its scope note. New standalone task also filed for the metrics-shape implementation once the read layer lands.

**References:** owner brief item 7.

---

## Delta 8 — Schema additions (extends rev 2 §4.3 schema block)

**Adds three schema pieces to `apps/core/src/db/schema.ts`. All migrations are additive.**

### 8.1 Per-agent fleet: `agent_sessions` table

Rev 2 §4.3 only carries the singular scalar `heartbeat.context_pct` — no per-agent breakdown. `coverage.md` §2 R4 marks this MISSING against the owner's requirement. Add:

```typescript
export const agent_sessions = sqliteTable('agent_sessions', {
  name: text('name').primaryKey(),             // Agent Teams session name, e.g. 'web-setup'
  pid: integer('pid'),
  model: text('model'),                        // 'opus-4.7' | 'fable-5' | …
  cwd: text('cwd'),
  cycle: integer('cycle'),                     // orchestration cycle at start
  context_pct: integer('context_pct'),         // 0-100, updated on hook stream
  current_tool: text('current_tool'),          // last PreToolUse-observed tool
  current_intent: text('current_intent'),      // free-text hint from the agent's last emit
  started_at: text('started_at').notNull(),
  updated_at: text('updated_at').notNull(),
  ended_at: text('ended_at'),
});
```

- Rows keyed on session name (matches Agent Teams / `claude agents --json` from GSL-212, already Done).
- Source: `claude agents --json` (poll 3–5 s) fills the roster; `PreToolUse` shim (part of GSL-267 hybrid hook) coalesces `current_tool` and `context_pct` updates server-side (debounce 1 s).
- `/fleet` projection reads this table + LEFT JOIN `heartbeat` for the fleet-total counters.

### 8.2 Manifest-rule provenance on `questions`

Add two columns to the existing `questions` table:

```typescript
applied_by: text('applied_by'),            // 'owner' | 'manifest' | 'orchestrator' | null (unanswered)
applied_rule_ref: text('applied_rule_ref') // e.g. 'docs/lab/decisions/manifest.md#rule-id' | null
```

Rev 2 §4.3 has the free-text `applied` field only; `coverage.md` §2 R1 flags this as a MISSING owner requirement ("show which rule the manifest applied"). New `POST /actions/questions/apply-manifest {qid, rule_ref}` spawns the same `lab-emit answer` with `--src=manifest --rule=<ref>` and INSERTs the provenance columns; the Questions UI renders the badge + hoverable rule text.

### 8.3 `defer` action + status enum extension

Add `'deferred'` to the `questions.status` enum values (already `'open' | 'answered' | 'resolved' | 'superseded'`) and add a nullable `defer_until` column:

```typescript
status: text('status').notNull(),  // + 'deferred'
defer_until: text('defer_until'),  // ISO-8601, nullable
```

New endpoint `POST /actions/questions/defer {qid, defer_until?}`. Defer without `defer_until` means "not now, ask me later"; with `defer_until` means "auto-reopen at that timestamp". `coverage.md` §2 R2 MISSING sub-clause.

**Impact on tasks:** GSL-261 (schema) gains these three additions as a migration slice. GSL-268 (POST actions) loses the "answer-only" scope and gains the two new endpoints (`apply-manifest`, `defer`) OR they are broken out as sibling tasks; the reconciliation creates them as sibling tasks so GSL-268 stays a single commit.

**References:** `coverage.md` §2 R1, R2, R4; `coverage.md` §7 G2, G3, G4.

---

## Delta 9 — Jira sync worker + `/actions/tasks/sync` (extends rev 2 §2 pipe row and §3.3 actions list)

**Replaces:** the implicit "inherit `poll-fill.py`" line in rev 2 §2 as the only Jira sync mechanism.

**Adds:** a background worker inside `gosleep-core` (`apps/core/src/workers/jira-sync.ts`) plus one endpoint.

- Worker cadence: every 5 minutes (configurable). Uses the Atlassian MCP if reachable from the daemon process, else a Bearer-token REST fallback (token in Keychain under `gosleep-jira-api`).
- Scope: refresh `tasks.status`, `tasks.title`, `tasks.labels`, `tasks.last_synced_at` for the current active epic set (`WHERE epic IN (<active epics>)`), plus the epic rows themselves.
- On change → INSERT `events` with `type='tasks.updated'` → SSE broadcaster emits.
- On-demand refresh: `POST /actions/tasks/sync {epic?}` triggers an immediate cycle.
- Acceptance: "row in Jira changed → row in web updates within N seconds" — N = worker interval, or ≤ 3 s if endpoint was called.

**Impact on tasks:** new sibling task filed. `coverage.md` §7 G5.

**References:** `coverage.md` §2 R6, §7 G5.

---

## Delta 10 — `SessionAdapter` interface (adds a new §12.1 to rev 2)

**Adds:** an interface layer isolating everything currently Claude-Code-specific.

Rev 2 §12 non-goals do not acknowledge the owner's R7 requirement (provider abstraction) at all; `coverage.md` §2 R7 marks this MISSING. The addendum introduces a **seed** — a thin interface only, no second implementation in v1.

```
packages/runner-adapter/
├── src/
│   ├── index.ts                    // export type SessionAdapter
│   ├── claude-code.ts              // impl: hooks + `claude agents --json` + tmux send-keys fallback
│   └── contract.md                 // the four seams
```

The four seams the interface must isolate (Claude-Code specifics today):

1. **Hook installation** — writing `.claude/settings.json` fragments.
2. **Fleet enumeration** — parsing `claude agents --json`.
3. **Steer path** — how the answer / permission decision is delivered back into a session (today: hook return, tomorrow: adapter's choice — WebSocket, RPC, whatever the provider offers).
4. **Transcript enrichment** — where post-hoc session history lives on disk and how to read it.

All Claude-Code-specific code in `apps/core/` must import via `packages/runner-adapter/` after v1's first stable release. v1 ships one adapter (`claude-code.ts`); the OpenAI/Codex placeholder is a `.md` sketch, not code.

**Impact on tasks:** new sibling task filed as a phase-2 seed; also a small note on GSL-263/267/268 (via comment) reminding them to import the paths through the adapter file (even in v1) so the seam exists.

**References:** `coverage.md` §2 R7, §7 G11.

---

## Delta 11 — Deprecation banner on stale `index.html` (adds a new task)

**Blocking staleness observed in `coverage.md` §5 S1.** `docs/reports/web-harness-research-2026-08-03/index.html` still recommends "variant A", which was superseded on 2026-08-03 by owner decision `d-2026-08-03-004` (Warren-model). Anyone opening the page reads the wrong recommendation.

**Fix (small, non-negotiable):** add a prominent HTML banner at the top of `index.html` — "Superseded by `target-architecture.md` revision 2 (owner decision `d-2026-08-03-004`) and its rev-3 addendum. Read those instead." — and a companion note at the head of the "Три варианта для нас" section. Do NOT regenerate the whole page (owner may still want the historical narrative).

**Impact on tasks:** new sibling task filed. `coverage.md` §7 G9.

---

## Summary of task impact

Extensions to existing GSL-250 tasks (via Jira comment referencing this addendum):

- **GSL-261 (DB schema)** — add the three schema pieces from Delta 8 (agent_sessions table, questions provenance columns, defer status + column).
- **GSL-263 (indexer + read + SSE)** — add `/metrics` endpoint (Delta 7); mark transcript tail as enrichment-only (Delta 3); `/fleet` reads from the new `agent_sessions` table (Delta 8.1).
- **GSL-264 (Security)** — TouchID = signed .app bundle (Delta 4); Keychain ACL + 5s timeout + 503 + Tahoe 26.x guard + per-boot audit line (Delta 5).
- **GSL-265 (client skeleton)** — pin Vite 7, Vite 8/Rolldown deferred (Delta 6).
- **GSL-267 (dual-write hooks)** — the shim now also installs the `PreToolUse{AskUserQuestion}` matcher for the answer-delivery loop (Delta 1); coalesces `current_tool`/`context_pct` for `agent_sessions` (Delta 8.1); imports Claude-Code specifics through the runner-adapter file (Delta 10).
- **GSL-268 (POST actions: answer, tick, ack, resolve)** — remains scoped to `answer` + `tick` + `ack` + `resolve`; `defer` and `apply-manifest` move to sibling tasks (Delta 8.2, 8.3).

New sibling tasks under GSL-250 filed by this reconciliation:

1. **GSL-272** — this rev-3 addendum (Docs).
2. **GSL-273** — PRD Phase 7 append (Docs).
3. **GSL-274** — Answer-loop smoke test, blocking PreToolUse{AskUserQuestion} + allow/updatedInput (Repo, **first executable, linchpin**).
4. Answer-delivery loop production task (Delta 1 in code).
5. Fleet: per-agent `agent_sessions` + PreToolUse emit + `/fleet` projection + Fleet screen (Delta 8.1).
6. Manifest-rule provenance: columns + `apply-manifest` endpoint + Questions badge (Delta 8.2).
7. Defer action: status enum + `POST /actions/questions/defer` + UI button (Delta 8.3).
8. Jira reconciler worker + `/actions/tasks/sync` (Delta 9).
9. `/metrics` endpoint (Prometheus exposition) (Delta 7).
10. `SessionAdapter` interface + Claude-Code adapter + OpenAI/Codex `.md` sketch (Delta 10).
11. Channels v1.1: gosleep-core as channel plugin, dev-flag, permission relay, turn-boundary steer (Delta 2).
12. Deprecation banner on `web-harness-research-2026-08-03/index.html` (Delta 11).

## End of addendum

This addendum is deltas only. Rev 2 stands as written except where the deltas above explicitly replace a paragraph. All tasks reference this file by path; when a task ships, its dev-history entry cites the delta number(s) it closed.
