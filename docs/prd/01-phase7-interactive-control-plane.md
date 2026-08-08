# PRD — Phase 7: Interactive control plane

> **Status:** Draft — 2026-08-07 (per-phase file, supersedes Phase 5 of the monolith)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Epic:** [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250)
> **Design source of truth:** `docs/reports/web-harness-research-2026-08-03/target-architecture.md` (revision 2, 2026-08-03) + `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` (revision 3, deltas only, 2026-08-07).
> **Owner requirements source:** decision-log entry `d-2026-08-03-007` (2026-08-03), verbally reaffirmed 2026-08-06, itemised as R1..R7 in `docs/reports/web-stack-audit-2026-08-06/coverage.md` section 2.
> **Answer-loop gate result:** `docs/dev_history/GSL-274-web-answer-loop-smoke.md` — PASS on all 5 sub-checks. Primary primitive validated: `permissionDecision: "allow"` + `updatedInput{questions, answers}`.
> **Parent PRD:** `docs/prd/PRD-gosleep-evolution.md` (Phases 1-6, historical archive). Phase 7 lives here as a standalone per-phase file per the 2026-08-07 owner language + file-layout rule.

---

## Positioning: Phase 7 supersedes Phase 5

Phase 5 of the parent PRD ("UI orchestration, static HTML v1") was superseded on 2026-08-03 by owner decision `d-2026-08-03-004` (Warren-model, SQLite = source of truth) and formally replaced by this Phase 7. The static HTML dashboard delivered by Phase 5 (chronicler-generated `docs/lab/site/*.html` + 7 screens) is kept as historical context and remains in git as an archive. All new UI work belongs to Phase 7 and epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250). The interactive requirements (runway with a binding constraint, live question window with countdowns, per-agent fleet, real-time updates, manifest-rule provenance) migrate into Phase 7 R7.\*. Do NOT plan new work against the Phase 5 tasks. (The first working "Publish skill" button initially migrated here too but was re-scoped out on 2026-08-08 — see [§ Moved to the skills-management phase (d-2026-08-08-002)](#moved-to-the-skills-management-phase-d-2026-08-08-002) below.)

---

## Re-scope on 2026-08-08

Per owner decision `d-2026-08-08-002` (2026-08-08, re: `q-2026-08-08-005`), the skills-publish acceptance items — the "Publish skill" button, the Skills screen, wiring the TouchID gate into a live write path, and the skills-registry writer — **moved out of Phase 7 and into the skills-management epic** ([GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174), postponed). They are relocated below, not deleted. Phase 7's live acceptance now stands alone on the web control plane. Rescope task: [GSL-296](https://ainstance-labs.atlassian.net/browse/GSL-296). Re-parented tickets: [GSL-266](https://ainstance-labs.atlassian.net/browse/GSL-266), [GSL-286](https://ainstance-labs.atlassian.net/browse/GSL-286), [GSL-287](https://ainstance-labs.atlassian.net/browse/GSL-287), [GSL-288](https://ainstance-labs.atlassian.net/browse/GSL-288), [GSL-292](https://ainstance-labs.atlassian.net/browse/GSL-292).

---

## Goal

A live web panel at `http://127.0.0.1:7331` from which the owner sees what the orchestra is doing right now, answers agent questions, and triggers basic write-actions (`answer`/`tick`/`ack`/`resolve` + `apply-manifest` + `defer` + `permissions/decide` + `tasks/sync`; the "Publish skill" write button was re-scoped to GSL-174 on 2026-08-08). Not a replacement for Remote Control (Phase 6). Does not try to work from the phone directly — the GitHub-served `mobile/README.md` lives independently.

---

## Scope

| In | Out (and why) |
|---|---|
| **Bun-workspaces monorepo:** `apps/core` (Bun 1.2+ + Hono 4.x + Drizzle + `bun:sqlite`), `apps/web` (React 19 + **Vite 7** + shadcn/ui + Tailwind v4 + TanStack Query v5 + react-router 7 + Recharts + Framer Motion + lucide-react), `packages/schema`, `packages/sdk`, `packages/runner-adapter` (SessionAdapter seed) | Node/Fastify runtime, Vite 8/Rolldown (v1.1), Prisma/Kysely (rev 2 §4.2 rationale), Next.js SSR (not needed) |
| **SQLite (WAL) = source of truth** (`data/gosleep.db`); Drizzle migrations + snapshots + JSONL as historical archive | JSONL as SoT (owner reversed, `d-2026-08-03-006`), Postgres (overkill for a single-user local instance) |
| **REST + SSE** via `packages/schema` (zod), `withTimeline` on every POST, per-endpoint concurrency=1, persistent idempotency | WebSocket (Warren consciously rejected), long-poll as the sole transport |
| **Layered authentication:** Bearer in macOS Keychain (ACL `-T`, 5 s timeout → 503, Tahoe 26.x guard), TouchID gesture (signed `.app` bundle) on high-blast writes, `withTimeline` audit, per-boot auth-source audit line | OAuth device-flow with an external IdP (no IdP), mTLS with per-user cert (overkill), token in plaintext (insufficient) |
| **v1 answer-delivery loop** = blocking `PreToolUse{AskUserQuestion}` hook long-polling gosleep-core; `allow` + `updatedInput{questions, answers}` on answer (or fallback `deny` + `permissionDecisionReason`); timeout → benign TUI fallback | `defer` primitive (print-mode only, DROPPED); channels as the primary path (turn-boundary only, v1.1); tmux `send-keys` as the primary path (last-resort fallback only, free-text) |
| **Per-agent fleet view** from `agent_sessions` (populated by `claude agents --json` + `PreToolUse` shim) with context %, current tool, current intent | Custom agent-runtime; integration with non-Claude-Code providers in v1 (seed via `SessionAdapter` only) |
| **Manifest-rule provenance** on questions (`applied_by`, `applied_rule_ref`) + `POST /actions/questions/apply-manifest` + badge in UI | Automatic synthesis of manifest rules from answer history (Learning loop, Phase 3; not implemented here) |
| **Defer action** on a question: `POST /actions/questions/defer {qid, defer_until?}` + status `'deferred'` | Algorithmic queue prioritisation |
| **Jira reconciler worker** inside gosleep-core (5-min cadence + `POST /actions/tasks/sync`) + SSE `tasks.updated` | Two-way Jira sync (write from UI to Jira — only via the orchestrator's existing MCP path) |
| **`/metrics` endpoint** (Prometheus text exposition) for the owner's local dashboards | External Prometheus scrape (local, `127.0.0.1` only) |
| **Channels v1.1 plugin** gosleep-as-channel: permission relay + owner-steer at turn boundaries, behind `--dangerously-load-development-channels` | Channels as the v1 path for questions (dialog is not relayed through a channel) |
| **`SessionAdapter` interface seed** (`packages/runner-adapter/`, one Claude-Code adapter, OpenAI/Codex — `.md` sketch) | Full multi-provider implementation in v1 (deferred, R7 seed only) |
| Dual-write hooks (`POST /internal/emit`); `answer`/`tick`/`ack`/`resolve` POST endpoints; 5 read-only screens + Questions/Fleet actionable *(the "Publish skill" write button, TouchID wiring, and the Skills screen were re-scoped out on 2026-08-08 — see § "Moved to the skills-management phase (d-2026-08-08-002)")* | Live steering via web (Phase 6 Remote Control); full mobile client (Phase 6); replay-then-tail live streaming (v1.1) |

---

## Success criteria

- **F7-S1.** Opening `http://127.0.0.1:7331`, the owner sees Overview with runway = min(), Timeline with sub-second SSE updates, Questions with a `kind` badge (BLOCKER/DECISION/CLARIFY/FYI) and answer provenance (`applied_by`, `applied_rule_ref` as hoverable), Fleet with a card per agent (context %, current tool, cycle, model), Tasks keyed by Jira with last-sync timestamp, and Cost. (Covers R5 + R1 + R4 + R6. Skills as a shipped screen re-scoped out — see § "Moved to the skills-management phase (d-2026-08-08-002)".)
- **F7-S2.** The owner clicks an option in the question dialog (or Custom, or Apply manifest rule, or Defer) → the choice reaches the agent that asked the question, via the `PreToolUse{AskUserQuestion}` hook within the long-poll budget (≤ 900 s default); on timeout the question renders gracefully in the TUI. (Covers R1 + R2.)
- **F7-S4.** Night scenario: an agent posts a BLOCKER question → the hook long-polls core → the agent does not stall in productive work (`POST /internal/emit` fire-and-forget), it just waits for the next tool call; in the morning the owner sees the queue and answers in a batch; answers reach agents within one tool call. (Covers R3 + R1.)
- **F7-S5.** `packages/runner-adapter/` collects Claude-Code specifics behind a single interface; `grep -R "claude agents" apps/core/src` returns no direct hits — only through the adapter (SessionAdapter seed). (Covers R7 seed.)

*F7-S3 (Publish skill via the UI button) was re-scoped out on 2026-08-08 — see § "Moved to the skills-management phase (d-2026-08-08-002)".*

---

## Requirements

- **R7.1 — Real-time question window with blocking status and manifest-rule provenance.** *Owner (`d-2026-08-03-007` + restated 2026-08-06):* "a real-time window of agent questions — a new question is visible immediately, with a status (blocking / non-blocking) and with a display of whether the answer was applied by the manifest and which rule specifically." *Target:* SSE update within a second after `POST /internal/emit`; in UI a `kind` badge (BLOCKER/DECISION/CLARIFY/FYI) with visual differentiation; when `applied_by='manifest'`, hoverable rule text from `applied_rule_ref`. *Acceptance:* F7-S1, F7-S4.
- **R7.2 — Web answer to a question: pick / custom / defer / apply-manifest + delivery to the agent.** *Owner:* "Owner responds from the web UI: pick an offered option, write a custom answer, defer the question, or answer via manifest" — plus "the answer reaches the agent that asked." *Target:* four buttons in the answer dialog, three POST endpoints (`answer`, `defer`, `apply-manifest`); delivery via blocking `PreToolUse{AskUserQuestion}` hook with fallback to `deny` + `permissionDecisionReason`. *Acceptance:* F7-S2 (in particular the "click → agent proceeds within one tool call" check).
- **R7.3 — Night mode: questions accumulate, agents do not stall.** *Owner:* "questions accumulate in the queue, agents do not stall." *Target:* `POST /internal/emit` is fire-and-forget from the agent's viewpoint (returns immediately, does not wait for an answer); the answer arrives with the next tool call. *Acceptance:* F7-S4, smoke assertion in GSL-269.
- **R7.4 — Fleet view: how many agents, what each is doing, context %.** *Owner:* "how many agents are running right now, what each is doing, what its context is." *Target:* `agent_sessions` table (rev-3 addendum §8.1), populated by `claude agents --json` (roster) + `PreToolUse` shim (context %, current tool); `/fleet` endpoint + Fleet screen with a card per agent. *Acceptance:* F7-S1 "Fleet cards", F7-S2 (when the owner answers a specific agent, it is visible where the answer landed).
- **R7.5 — Near-second live updates via an event stream (not polling).** *Owner:* "updates close to one second, an event stream, not a timer poll." *Target:* SSE via `EventEmitter` from SQLite; `Last-Event-ID`, `event: rotate` at UTC rollover; latency = INSERT → SSE ≤ 1 s. *Acceptance:* F7-S1 (Timeline sub-second), GSL-263 acceptance.
- **R7.6 — Tasks view + Jira sync.** *Owner:* "tasks visible + reflects Jira." *Target:* Jira reconciler worker (rev-3 addendum §9), 5-min cadence + on-demand `POST /actions/tasks/sync`; SSE `tasks.updated` on change. *Acceptance:* F7-S1 "Tasks with last-sync timestamp"; a row change in Jira → row change in UI ≤ (interval + 3 s).
- **R7.7 — Future-proofing: providers beyond Claude Code (SessionAdapter seed).** *Owner:* "Future-proofing: providers other than Claude Code later (abstraction of the agent runner)." *Target:* seed only — `packages/runner-adapter/` with one working adapter (`claude-code.ts`) and a `.md` sketch for OpenAI/Codex; all Claude-Code specifics in `apps/core/` are imported through the adapter. *Acceptance:* F7-S5.

---

## Tasks (epic `[Web][Repo] Interactive management web interface (control plane)`, [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250))

Existing GSL-258…GSL-271 cover the spine (schema, indexer, SSE, security, client skeleton, first write button, dual-write hooks, POST actions, docs, deprecation, final switch) — the plan from target-architecture section 9, steps 1-12. Plus tasks created by the 2026-08-07 reconciliation under the rev-3 addendum:

1. **GSL-274** (first executable, linchpin, 30-min timebox) — `[Repo][Web] Answer-loop smoke test: blocking PreToolUse{AskUserQuestion} + allow/updatedInput on a live subscription session`. **Result: PASS on all 5 sub-checks (2026-08-07)** — production primitive is `allow` + `updatedInput{questions, answers}`; `deny` + reason kept as documented fallback only. Evidence: `docs/dev_history/GSL-274-web-answer-loop-smoke.md`.
2. **GSL-272** — `[Docs][Web] Architecture rev-3 addendum` (the delta document series).
3. **GSL-273** — `[Docs][Web] PRD Phase 7` (this file plus the pointer in the parent PRD).
4. Answer-delivery loop production (long-poll shim + `wait` endpoint) — **GSL-275**.
5. Fleet: `agent_sessions` table + PreToolUse emit + `/fleet` + Fleet screen — **GSL-276**.
6. Manifest-rule provenance + `POST /actions/questions/apply-manifest` + badge — **GSL-277**.
7. Defer action: enum + `POST /actions/questions/defer` + UI button — **GSL-278**.
8. Jira reconciler worker + `POST /actions/tasks/sync` — **GSL-279**.
9. `/metrics` endpoint (Prometheus exposition) — **GSL-280**.
10. `SessionAdapter` interface + Claude-Code adapter + OpenAI/Codex `.md` sketch — **GSL-281**.
11. Channels v1.1: gosleep-as-channel plugin (dev-flag, permission relay, turn-boundary steer) — **GSL-282**.
12. Deprecation banner on `docs/reports/web-harness-research-2026-08-03/index.html` — **GSL-283**.
13. Extensions to existing GSL-263 (`/metrics` + `/fleet`, transcript enrichment-only), GSL-264 (.app bundle + Keychain hardening), GSL-265 (Vite 7), GSL-267 (AskUserQuestion shim + `agent_sessions` coalesce), GSL-268 (defer/apply-manifest carved out of scope) — tracked by comments that point back to the rev-3 addendum.

---

## Effort estimate

**XL** (30-38 days for one worker with a +40% honest buffer, target-architecture section 11; the first working button — 17-21 days, step 7). With two workers in parallel — 22-26 calendar days. The rev-3 addendum adds ~5-7 days (fleet schema, answer-loop shim, manifest provenance, /metrics, Jira reconciler).

---

## Dependencies

Phase 3 (question buffer semantics; `queue.jsonl` schema migrates into the `questions` table). Phase 4 (`docs/lab` layout as the source for historical import). *(The GSL-174 stages 2-3 dependency — `tools/skills/publish.sh` + `docs/skills/CHANGELOG.jsonl` — was previously listed here as a prerequisite for the "Publish skill" button; on 2026-08-08 that button moved out of Phase 7 into GSL-174, so the dependency is no longer required for Phase 7 acceptance. See § "Moved to the skills-management phase (d-2026-08-08-002)".)*

---

## Non-goals (explicit)

- Full mobile client — Phase 6 (Remote Control + hook→ntfy + Telegram + Tailscale break-glass).
- Live steering via web (interactive write-to-TTY) — Phase 6 Remote Control.
- Multi-provider runner (SessionAdapter — seed only, no second adapter in v1).
- Vite 8 / Rolldown default bundler — v1.1.
- Real-time live streaming from channels — v1.1 (turn-boundary only via dev-flag).
- Prometheus scrape by an external service — `/metrics` on `127.0.0.1` only.
- Automatic synthesis of manifest rules — Learning loop, Phase 3.

---

## Risks (in addition to R26-R38 from target-architecture section 12)

- (R) **Primary answer-loop path does not work in interactive mode.** *Mitigation:* documented fallback `deny` + `permissionDecisionReason` is validated by the same 30-min GSL-274 timebox; on primary failure — switch the GSL-268 contract to the fallback. **Status 2026-08-07: primary confirmed working (GSL-274 PASS); fallback retained as a config-selectable alternative.**
- (R) **Tahoe 26.x regression of the Keychain CLI breaks production authentication.** *Mitigation:* rev-3 addendum §5 fixes the policy (5 s timeout, ASCII-only Base64 shim, per-boot audit line); GSL-264 acceptance includes a test on a 26.x machine.
- (R) **`.app` bundle signing on the owner's new machine does not work (no provisioning profile).** *Mitigation:* ad-hoc `codesign -s -` without a provisioning profile; entitlements plist is committed; GSL-264 e2e runs on the real machine.
- (R) **`--dangerously-load-development-channels` full-screen consent dialog on every session start.** *Mitigation:* channels are v1.1, not v1; v1 lives entirely on hooks with no channels dependency.
- (R) **`SessionAdapter` seed degrades into vaporware.** *Mitigation:* GSL-267 and three sibling tasks (fleet, answer-delivery, manifest) are required to import via the adapter file even in v1 — the seam stays alive.

---

## Acceptance criteria + end-check

- **Gates:** `bun --filter='@gosleep/core' test`; `smoke.sh` (rev 2 §5.3 rules + new guards from GSL-269); `install-deps.sh` on a clean machine builds the `.app` bundle; `plist.sh install` registers launchd.
- **End-check:** after installation the owner opens `http://127.0.0.1:7331` in Safari/Chrome on the MacBook, sees live Overview with runway and Fleet, answers a real agent question through the web (the agent sees the answer within one tool call), takes a manual snapshot through a button. Preact-SSG stops being invoked by the chronicler (`GOSLEEP_KEEP_STATIC_SITE=0`); `mobile/README.md` continues to work via GitHub rendering (Phase 5 archive-mode). *(The "publish a skill via the TouchID prompt" step was part of this end-check until 2026-08-08; it moved to GSL-174 — see § "Moved to the skills-management phase (d-2026-08-08-002)".)*

---

## References

- Target architecture (design source of truth): `docs/reports/web-harness-research-2026-08-03/target-architecture.md` (revision 2).
- Rev-3 addendum (11 deltas): `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`.
- Owner requirements decomposition (R1..R7 + gap analysis): `docs/reports/web-stack-audit-2026-08-06/coverage.md` section 2.
- Fable-final adjudication (channels, answer-loop primitives): `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md`.
- Answer-loop smoke result (linchpin gate PASS): `docs/dev_history/GSL-274-web-answer-loop-smoke.md` + `docs/dev_history/assets/GSL-274/`.
- Decision log entries: `d-2026-08-03-004`, `d-2026-08-03-006`, `d-2026-08-03-007`, `d-2026-08-08-002` in `docs/lab/decisions/log.jsonl`.
- Parent PRD (Phases 1-6, historical archive): `docs/prd/PRD-gosleep-evolution.md`.
- Re-scope task (this PRD edit + Jira re-parent + PR annotation): [GSL-296](https://ainstance-labs.atlassian.net/browse/GSL-296).

---

## Moved to the skills-management phase (d-2026-08-08-002)

**Decision.** Owner decision `d-2026-08-08-002` on 2026-08-08 (re: `q-2026-08-08-005`): *"PRD Phase 7 re-scoped: skills-publish acceptance moves to the GSL-174 phase; verifier tickets GSL-286/287/288/292 re-parent accordingly."* The prerequisite (epic [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) stages 2-3 — `tools/skills/publish.sh` + `docs/skills/CHANGELOG.jsonl`) was postponed by the owner, so building the first write button on top of it in Phase 7 was no longer sequenceable. The web control plane stands alone.

**Content moved (kept verbatim below so the record survives).**

### Scope row — "First write button 'Publish'"

Originally in the § Scope table under "In":

> **First write button "Publish"** (`POST /actions/skills/publish` + TouchID e2e); dual-write hooks (`POST /internal/emit`); `answer`/`tick`/`ack`/`resolve` POST endpoints; 5 read-only screens + Questions/Fleet actionable

Post-re-scope, only the second half stays in the live Scope table (dual-write hooks + POST endpoints + 5 screens + Questions/Fleet actionable). The "Publish" write button + `POST /actions/skills/publish` + TouchID e2e — now GSL-174 scope.

### Success criterion F7-S3 (moved verbatim)

> **F7-S3.** Publish a skill via the UI button: click → TouchID prompt on the `.app` bundle → `publish.sh` snapshot + rsync + append CHANGELOG.jsonl → snapshot after, timeline records every step with `actor="web"`. (Covers the first write button.)

Now a GSL-174 success criterion; will be restated in that epic's PRD when the skills-management phase is planned.

### F7-S1 clause "Skills" (moved verbatim)

Originally F7-S1's shipped-screens sentence included **Skills** as one of the seven screens the owner sees on opening `http://127.0.0.1:7331`. Post-re-scope, F7-S1 promises six screens (Overview / Fleet / Timeline / Questions / Tasks / Cost). The Skills screen lands under GSL-174. Router unknown-route behaviour (GSL-295, landed) already renders a NotFound screen for `/skills` instead of silently redirecting, so the missing surface is visible until GSL-174 fills it in.

### End-check step "publishes a skill via the TouchID prompt" (moved verbatim)

Originally in the End-check paragraph:

> …publishes a skill via the TouchID prompt…

Now a GSL-174 end-check step.

### Dependencies — GSL-174 stages 2-3 (moved verbatim)

Originally in the § Dependencies paragraph:

> Epic [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) (skills governance) step 7 — the first "Publish skill" write button depends on `tools/skills/publish.sh` + `docs/skills/CHANGELOG.jsonl` (stages 2-3 of GSL-174).

Post-re-scope: `tools/skills/publish.sh` + `docs/skills/CHANGELOG.jsonl` become intra-epic prerequisites within GSL-174 (their natural home), not cross-epic prerequisites for Phase 7. Phase 7 has no outstanding GSL-174 dependency.

### Re-parented tickets (Jira)

The following tickets were re-parented from epic GSL-250 → epic GSL-174 in the same commit that landed this PRD edit, with labels rewritten (`GSL-250` → `GSL-174`), plus `moved-from-GSL-250` and `rescope-2026-08-08` added:

* [GSL-266](https://ainstance-labs.atlassian.net/browse/GSL-266) — first write button (`POST /actions/skills/publish` + Skills screen + TouchID e2e). Extra label: `skills-publish`. GH mirror: [issue #266](https://github.com/ainstance-labs/gosleep/issues/266) (annotated).
* [GSL-286](https://ainstance-labs.atlassian.net/browse/GSL-286) — verifier: `POST /actions/skills/publish` endpoint absent (CRITICAL, finding stays valid, scope moves). No GH mirror.
* [GSL-287](https://ainstance-labs.atlassian.net/browse/GSL-287) — verifier: no Skills screen in the web UI (CRITICAL). No GH mirror.
* [GSL-288](https://ainstance-labs.atlassian.net/browse/GSL-288) — verifier: TouchID `.app` bundle never invoked from core (Security / CRITICAL — the bundle shipped as part of the layered-auth work in GSL-264, but wiring it into a live write path is a GSL-174 deliverable now). No GH mirror.
* [GSL-292](https://ainstance-labs.atlassian.net/browse/GSL-292) — verifier: `/skills` endpoint returns empty (MAJOR — the schema + read projection stay in the shipped core; the writer moves to GSL-174). No GH mirror.

### Cross-references

* Decision: `docs/lab/decisions/log.jsonl` id `d-2026-08-08-002` (`ts: 2026-08-08T15:49:50Z`, `made_by: owner`).
* Question: `docs/lab/questions/archive.jsonl` id `q-2026-08-08-005`.
* Re-scope task: [GSL-296](https://ainstance-labs.atlassian.net/browse/GSL-296) — one commit under this task carries every change described in this section.
* Epic that now owns the moved items: [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) — see the "Scope grew on 2026-08-08" comment for the epic-side summary.
* PR #295 (GSL-250) body annotation: the unchecked "First write button" line and a new "Re-scope 2026-08-08" section name every moved ticket. The PR stays open under GSL-250 acceptance and merges without the moved items.
