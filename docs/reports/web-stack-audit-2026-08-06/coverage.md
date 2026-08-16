# Coverage audit: interactive web control plane vs. owner requirements, red-team, and Jira breakdown

**Author:** worker `audit-coverage`, shift 75 of gosleep (Claude Opus 5).
**Date:** 2026-08-06.
**Scope:** read-only, skeptical.
**Object:** target architecture `docs/reports/web-harness-research-2026-08-03/target-architecture.md` (revision 2, 974 lines), red-team `redteam-verdict.md` (3 critical / 5 major / 6 minor), design-system, three finding files, PRD phases 1-6, decision log entries `d-2026-08-03-001` … `d-2026-08-03-008`, and Jira epic **GSL-250** with tasks **GSL-258 … GSL-271** (14 tasks total) plus cross-referenced GSL-174/GSL-253/GSL-255/GSL-212.
**Verdict headline:** the architecture broadly satisfies the physical requirements (SQLite as source of truth, SSE stream, layered auth, Bearer+TouchID) and picks up nine of eleven red-team findings from revision 1. **The interactive-control-plane requirements the owner restated on 2026-08-06, however, are only partially covered.** Two owner requirements are effectively missing (R1's manifest-rule provenance and R7's provider abstraction); three are partial (R1 blocking status + R2 defer/pick-option, R4 per-agent fleet view, R6 Jira sync); the answer-delivery loop back to a currently-active agent is not closed end-to-end anywhere in the design.

**Not committed.** Discussion artefact.

---

## 1. One-page verdict

| Category | Count |
|---|---|
| Owner requirements (R1-R7) fully COVERED | **1** (R5 near-second updates) |
| Owner requirements PARTIAL | **4** (R1, R2, R3, R4, R6) |
| Owner requirements effectively MISSING | **2** (R1 manifest-rule provenance sub-clause; R7 provider abstraction) |
| Red-team findings addressed in revision 2 | **11 of 14** (all 3 critical + all 5 major + 3 of 6 minor) |
| Red-team findings still open/unclear | **3 minor** (#10 ledger label, #12 fs.watch cache-policy explicit, #13 launchd flags explicit; policy captured in text but not tied to a Jira task) |
| Internal contradictions found | **4** (see §5) |
| Stale content in the research folder | **1 blocking** (`index.html` still recommends "variant A" that was superseded by owner decision `d-2026-08-03-004`) + **3 minor** wording drifts |
| **Ranked gaps needing tickets** | **11** (§7) |

**Bottom line for the orchestrator.** Rev.2 target-architecture and the GSL-258..271 breakdown are ship-shape for the storage + auth + read-only + first-publish spine. They are **not** ready for what the owner asked for today. Before the epic starts, add at minimum three tickets: (a) close the answer-delivery loop back to an active agent (Warren-style steer), (b) add the decision-manifest lookup + rule-provenance column to `questions` and to the UI, (c) build the per-agent fleet view on top of `claude agents --json` (GSL-212 delivered the data source). Two more tickets are recommended for R2 "defer" and R6 Jira sync worker. R7 provider abstraction can be a phase-2 note.

---

## 2. Coverage matrix — owner requirements → architecture → Jira → verdict

Verdicts: **COVERED** — requirement explicit in both the architecture and a Jira task, with a concrete data model, endpoint, and UI element. **PARTIAL** — data path exists but at least one owner sub-clause is not spec'd. **MISSING** — no data model, endpoint, or UI element in either the architecture or any task.

### R1 — real-time window of agent questions with blocking status and manifest-rule display

> *Owner (d-2026-08-03-007 + restated 2026-08-06):* «окно вопросов от агентов в реальном времени — новый вопрос виден сразу, со статусом (блокирующий/не блокирующий) и с показом, что ответ дан по манифесту и какой именно».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Real-time visibility of a new question | §3.3 endpoints `GET /questions`, `GET /events` (SSE) + §6.1 «`GET /events?since=<seq>` — SSE-стрим напрямую из `events`-таблицы через in-process `EventEmitter`; при коммите новой строки индексатор эмитит событие, broadcaster рассылает» (target-arch:668-669) | GSL-263 (indexer + SSE), GSL-265 (client screen, read-only Questions) | **COVERED** for questions posted via `lab-emit question` after migration step 5. | schema has `questions.opened_at` (target-arch:388); `POST /internal/emit` from GSL-267 lands rows in `events` directly with sub-second latency after step 8. |
| Blocking vs non-blocking status shown in UI | §4.3 `questions.kind: 'BLOCKER'\|'DECISION'\|'CLARIFY'\|'FYI'` (target-arch:385) — data exists. **UI rendering not spec'd** anywhere. | GSL-265 shows a Questions read-only screen but its description does not say the `kind` badge is displayed with visual distinction between BLOCKER and non-blocker. | **PARTIAL** — data model has the field, the UI task is silent on visualisation and on any "agent is blocked right now" state indicator. |
| «Answer was applied by the decision manifest — show which rule» | **Not present.** The word «manifest» appears **zero times** in `target-architecture.md`. `questions.applied: text('applied')` (target-arch:391) is nullable free-text with no schema, no FK to any manifest file, no rule-id enumeration. The `decisions` table (target-arch:396-402) also has no `rule_ref` column. | **No task** in GSL-258..271 mentions manifest, rule provenance, or `applied_by_manifest`. | **MISSING** — this is a top-3 gap. The PRD explicitly frames manifest as "owner-sovereign, every automated decision cites the manifest rule" (`PRD-gosleep-evolution.md:334, 343, 361, 369`) but revision 2 target-arch dropped the concept entirely from the schema and endpoint list. |

**Combined R1 verdict:** **PARTIAL** with a MISSING sub-clause. Fix: add columns `questions.applied_by` (`owner`\|`manifest`\|`orchestrator`) and `questions.applied_rule_ref` (path to `decisions/manifest.md#rule-id`); teach `POST /actions/questions/answer` to accept both a free-text answer and an "apply-manifest" mode carrying the rule reference; render both in the Questions screen.

---

### R2 — owner responds from the web UI: pick an offered option, write custom, defer, or answer via manifest

> *Owner (restated 2026-08-06):* «Owner responds from the web UI: pick an offered option, write a custom answer, defer the question, or answer via manifest».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Free-text answer | `POST /actions/questions/answer` → spawn `lab-emit.sh answer` (target-arch:679, §6.2 table) | GSL-268 «POST actions: answer, tick, ack, resolve + four UI elements» | **COVERED** — endpoint exists, dual-write via `lab-emit-hybrid.sh` (target-arch:679). |
| Pick one of the offered options structured (not just paste text) | `questions.options: text('options', {mode:'json'})` in schema (target-arch:387) — data exists. Endpoint contract does not describe "answer with option-index"; `lab-emit.sh answer` today is free-text only. | GSL-268 description: «Idempotency-Key protects against a double click» + «TouchID is NOT required» — no mention of structured option picker. | **PARTIAL** — data column exists in the schema, no endpoint/UI wiring described. |
| **Defer** action | **Not present.** No `/actions/questions/defer` endpoint anywhere in §3.3 or §6.2. Schema `questions.status` (target-arch:383) enumerates `'open'\|'answered'\|'resolved'\|'superseded'` — **no `deferred`**. | No task in GSL-258..271 mentions defer. | **MISSING** — direct gap. |
| Answer via manifest (owner clicks "apply rule X") | See R1 sub-clause above — same missing concept. | Same. | **MISSING**. |

**Combined R2 verdict:** **PARTIAL** with two MISSING sub-clauses (defer + manifest). Fix: extend the enum, add `POST /actions/questions/defer` with an optional `defer_until`, add option-pick payload to the `answer` endpoint, and thread manifest-rule reference through as above.

---

### R3 — night mode: questions accumulate in the queue, agents do not stall

> *Owner:* «questions accumulate in the queue, agents do not stall».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Queue is durable | `questions` table in SQLite + `queue.jsonl` dual-write (target-arch:679) | GSL-261 (schema), GSL-262 (JSONL import), GSL-268 (answer endpoint) | **COVERED** — natural side effect of the append-only queue. |
| Agents don't stall when a question is posted | **Not verified in the architecture.** The doc never says "agents keep working after posing a question"; that is a property of the current `lab-emit question` skill (fire-and-forget append), inherited by construction but never re-affirmed for the new stack. The PRD frames it explicitly (Phase 3: «вопросы не блокируют ночь»). | No task carries an acceptance criterion "agent that posed a blocking question continues to be productive". | **PARTIAL** — implied by the existing skill, not asserted anywhere in the new plan. |

**Combined R3 verdict:** **PARTIAL**. Fix: add a paragraph to §3 or §9 asserting that `POST /internal/emit` from an agent hook returns immediately (fire-and-forget from the agent's perspective) and does not block on owner action; add a smoke assertion in GSL-269 that a `question.posed` emit returns within a bounded time regardless of owner presence.

---

### R4 — fleet view: how many agents are running, what each is doing, its context %

> *Owner:* «сколько агентов запущено сейчас, что каждый делает, какой у него контекст».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| How many agents are running | §4.3 `heartbeat.open_workers: integer` (target-arch:428) + `/fleet` endpoint listed in §3.3 (target-arch:277). | GSL-263 lists `/fleet` among read endpoints; no task describes its projection. | **PARTIAL** — data exists, endpoint enumerated, projection not spec'd. |
| Context % (per agent) | `heartbeat.context_pct: integer` (target-arch:427) — **singular scalar**. No per-agent breakdown in the schema. | Same. | **MISSING as spec'd** — the `heartbeat` table records a single scalar per row (per orchestrator tick), not per agent. GSL-212 (Done) added a `session` field to heartbeat and pinned "source of truth = `claude agents --json`", but revision 2 does not mention `claude agents --json` and does not add a per-agent `agents` table. |
| What each agent is doing right now | **Not present.** The PreToolUse hook that would emit "agent X entered tool Y at timestamp Z" is only alluded to in the decision-log entry (`d-2026-08-03-007`: «Нужны: PreToolUse-эмиссия для "что делает прямо сейчас" и коалесинг обновлений») — the target-architecture does not add such a hook to §3.3 spawn list nor to `.claude/settings.json` changes; no Jira task adds it. | None. | **MISSING** — direct gap and explicitly requested by the owner in the decision that created the epic. |

**Combined R4 verdict:** **PARTIAL** with a MISSING sub-clause. Fix: (a) add `agents` (or `agent_sessions`) table keyed on session name with columns `name, pid, model, cwd, cycle, context_pct, current_tool, current_intent, updated_at`; (b) add a PreToolUse hook `pre-tool-emit.sh` to `.claude/settings.json` that POSTs to `/internal/emit` with `{type:"agent.tool.start", session, tool, tool_args_hash}`, coalesced server-side; (c) source the roster from `claude agents --json` (delivered by GSL-212 — already Done); (d) put a task under GSL-250 to implement all three.

---

### R5 — near-second updates via an event stream, not timer polling

> *Owner:* «обновление близкое к секундному, поток событий, а не опрос по таймеру».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Push, not polling | SSE via `EventEmitter` + `GET /events?since=<seq>` (§3.3, §6.1) with `Last-Event-ID` and `event: rotate` for UTC-day change (target-arch:668-671, GSL-263 acceptance). | GSL-263, GSL-265. | **COVERED** — architecture and Jira align. |
| Near-second latency end-to-end | Hooks → `POST /internal/emit` → INSERT → EventEmitter → SSE = sub-second (after step 8). Tail-JSONL path is bounded by `fs.watch` (macOS FSEvents ≤ 500 ms per R35) + 10-second poll fallback — worst case 10 s during the transitional window. | GSL-263 acceptance «на новом `lab-emit` из другой shell — новая строка появляется в стриме в течение секунды» — sets the target explicitly. | **COVERED** for the steady state after step 8; **worst-case 10 s** during steps 5-7. Acceptable, but worth documenting. |

**Combined R5 verdict:** **COVERED**. This is the strongest requirement match in the whole plan.

---

### R6 — tasks view + Jira sync

> *Owner:* tasks list is visible in the panel, and it reflects Jira.

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Tasks visible in UI | `/tasks` endpoint (§3.3), `tasks.tsx` screen (GSL-265 lists «tasks.tsx» among five read-only screens). | GSL-263 (endpoint), GSL-265 (screen). | **COVERED** for reading whatever is in the `tasks` table. |
| Jira sync mechanism | Schema has `tasks.key, epic, status, title, labels, last_synced_at` (target-arch:405-412) and §2 lists «`poll-fill.py (reconcile git/gh/Jira)` → `lab-log.sh (--src=poll-fill)`» (target-arch:49) — i.e. the sync is inherited from the current `poll-fill.py`, not built anew in the core. **However:** neither §3.3 nor any Jira task mentions a background worker inside `gosleep-core` that keeps `tasks.last_synced_at` fresh, and `poll-fill.py` only mirrors reconcile events into JSONL, not directly into the `tasks` table. | No task. | **PARTIAL** — data column exists, sync worker is only implicit ("we still run `poll-fill.py`") and there is no owner-facing "sync now" action, no Jira MCP integration point in core, and no acceptance for "row in Jira changed → row in web updates within N seconds". |

**Combined R6 verdict:** **PARTIAL**. Fix: add a task «Jira reconciler in `gosleep-core`» — a periodic (e.g. every 5 min) worker that uses the Atlassian MCP or REST to refresh `tasks` for the current epic set, plus `POST /actions/tasks/sync` for on-demand refresh, plus an SSE event `tasks.updated`.

---

### R7 — future-proofing: providers other than Claude Code later

> *Owner:* «Future-proofing: providers other than Claude Code later (abstraction of the agent runner)».

| Sub-clause | Where in architecture | Jira task | Verdict | Evidence |
|---|---|---|---|---|
| Agent-runner abstraction | **Not present.** The architecture is Claude-Code-specific throughout: (a) hook shim `lab-log-hook.sh` in §2 is a Claude Code artefact; (b) `claude agents --json` referenced in the decision `d-2026-08-03-007` is the fleet source; (c) TouchID gate protects `publish.sh` — same for any provider, fine — but there is no dispatch/steer abstraction, no `Provider` interface, no notion of "what does an OpenAI-based agent shim look like" anywhere in `apps/core/`. | None. | **MISSING** — the requirement is future-proofing, so this can be a Phase-2 note, but the plan doesn't even acknowledge the constraint. |

**Combined R7 verdict:** **MISSING** (accepted as low-urgency; the fix is a design note, not a task). Fix: append a short §13 to the target-architecture: «Provider abstraction (deferred to phase 2)» sketching a `packages/runner-adapter/` interface with two implementations, one for Claude Code (hooks + `claude agents --json`), one placeholder for OpenAI/Codex. Add a note in `packages/schema` that event `src` values are open-ended.

---

## 3. Red-team reconciliation — 14 findings → revision 2

Each red-team finding rated: **CLOSED** (rev.2 has a concrete mitigation and a Jira task); **CAPTURED** (rev.2 documents the concern but the Jira task doesn't carry an acceptance for it); **OPEN** (not addressed anywhere).

### Critical (3)

| # | Red-team finding | Rev.2 handling | Jira task | Verdict |
|---|---|---|---|---|
| 1 | Loopback protects only against browser XSS, not against local agents (no Bearer, no Host check, no TouchID) | §7 layered auth: Bearer in macOS Keychain + TouchID + Host + Origin + env-secret in spawn (target-arch:718-745); redteam:38 fix set out point-for-point | GSL-260 (host/origin/bearer stubs), GSL-264 (persistent, TouchID integration, setup flow) | **CLOSED** |
| 2 | `chronicler.sh --quiet` synchronous race with parallel debounce | §5.3 rule 3 + step 2 (target-arch:770-772) — top-level mkdir-lock in `chronicler.sh` or route through `tick.sh --force` | GSL-259 (dedicated task, acceptance names race test) | **CLOSED** |
| 3 | PostToolUse hook doesn't fire for `child_process.spawn` from server | `withTimeline` writes each server action to `events` with `actor="web"` (target-arch:246) + `server_intents` table for orphan reconcile (target-arch:432); mitigation is described but there is no explicit test asserting "server-spawn side-effects are still visible in the timeline after a crash between CLI and rebuild" | GSL-264 «withTimeline covers all POST endpoints, orphan-intent reconcile passes smoke» | **CLOSED** — the mitigation from redteam #3 was "either document the 5-min tick fallback or emit a UI banner"; rev.2 chose the audit-trail path. |

### Major (5)

| # | Red-team finding | Rev.2 handling | Jira task | Verdict |
|---|---|---|---|---|
| 4 | «1-2 days to first working button» is optimistic — real path 3.5-5 days | §11 timelines: «Первая рабочая кнопка (шаг 7): 17-21 дня» (target-arch:891) with +40 % buffer | GSL-250 body «First working write button — 17-21 days» | **CLOSED** — rev.2 owns the honest number. |
| 5 | UTC-day rotation breaks SSE tail (inode + name change) | §3.3 `sse/rotation.ts` + R34 (target-arch:919) — event rotate on UTC change | GSL-263 acceptance «UTC-midnight test» | **CLOSED** |
| 6 | In-memory idempotency Map doesn't survive `launchctl reload` | §3.3 `security/idempotency.ts` — «persistent `.artifacts/web/idempotency.jsonl`» (target-arch:245) | GSL-264 «Idempotency-Map is persistent: `launchctl kickstart -k` does not lose keys» | **CLOSED** |
| 7 | Owner-check via `$USER` — env-secret pattern needed | §7 layered auth + spawn env `GOSLEEP_WEB_TOKEN` (target-arch:864); §3.3 `spawn/publish.ts` | GSL-253 (`publish.sh` accepts env-secret), GSL-264 (server sets it) | **CLOSED** |
| 8 | Referer/Origin insufficient — need Host + composite policy | §7 «Host-header check — только `127.0.0.1:7331`; Origin/Referer — обязателен хотя бы один» (target-arch:731-733) | GSL-260 (host + origin middleware), GSL-269 (security suite) | **CLOSED** |

### Minor (6)

| # | Red-team finding | Rev.2 handling | Jira task | Verdict |
|---|---|---|---|---|
| 9 | 623 KB `render_bundle.json` re-read per request; use ETag/304 | Rev.2 abandons the file — «/bundle теперь возвращает проекцию из SQLite» (target-arch:666), so the concern evaporates; but the doc doesn't say "no need for ETag" so a reader might still add it | Implicit in GSL-263 | **CAPTURED** — behaviour is correct by construction, no explicit note. |
| 10 | Debounce waiter logs a `mode:"debounce"` phantom | GSL-259 «Ledger distinguishes sources (`mode:"web"` vs `mode:"debounce"`)» | GSL-259 | **CLOSED** |
| 11 | `lab-emit answer` doesn't guard on `status='open'` — two answers pass | GSL-268 «The `status='open'` guard on answer actually rejects a second answer» | GSL-268 | **CLOSED** |
| 12 | `fs.watch` on macOS has ≥100 ms rename lag — don't build watch-based caching | R35 (target-arch:920) acknowledges 200-500 ms and adds 10-s poll fallback; but does NOT explicitly forbid watch-based caching of `render_bundle.json` (moot now) | Implicit in GSL-263 | **CAPTURED** — behaviour correct by construction; concern didn't have to be re-litigated. |
| 13 | `SessionCreate=true`+`RunAtLoad=false` needs manual `launchctl load` per session | Rev.2 targets `RunAtLoad=true, SessionCreate=true, KeepAlive={"SuccessfulExit":false}` (GSL-260 plist paragraph) — flag combo fixed | GSL-260 | **CLOSED** |
| 14 (was #14 in redteam ordering) | «~200 LOC client-actions.ts» is optimistic; realistically 400-500 | Rev.2 §11 uses days-per-step estimates rather than LOC; no LOC target survived | GSL-265 sets acceptance in terms of functionality (SSE reconnect, event rotate handling, TanStack Query) rather than LOC | **CLOSED** (obsolete concern). |

### Forgotten work (§«Забытые архитектором работы» in redteam, items 1-10)

| # | Concern | Rev.2 handling | Verdict |
|---|---|---|---|
| 1 | Bun/Hono/zod install stack | GSL-260 install-deps.sh | **CLOSED** |
| 2 | launchd plist install/uninstall with secret migration | GSL-260 `plist.sh install/uninstall` | **CLOSED** |
| 3 | CHANGELOG.jsonl schema + validator | GSL-174 stage 2 (out of this epic; explicitly cross-referenced from GSL-250 body) | **CLOSED** |
| 4 | New `skills.html` page in chronicler | GSL-255 (out of this epic, cross-referenced) | **CLOSED** |
| 5 | Smoke guards for new tree | GSL-269 lists six new guards | **CLOSED** |
| 6 | SSE-rotation midnight tests | GSL-263 acceptance | **CLOSED** |
| 7 | Chronicler-race tests | GSL-259 acceptance | **CLOSED** |
| 8 | Bearer setup flow in UI | GSL-264 setup-flow | **CLOSED** |
| 9 | CLAUDE.md + runbook update | GSL-258 (+40 lines) + GSL-269 (runbook) | **CLOSED** |
| 10 | Integration with `hooks-verify.sh` / `smoke.sh` | GSL-269 acceptance | **CLOSED** |

### Summary

- **All 3 critical + all 5 major + 3 of 6 minor red-team findings** have a mitigation in text **and** a Jira acceptance line.
- **3 minor findings** (#9, #12, #14) are addressed by the SQLite-first pivot itself and can be treated as obsolete; but the target-architecture doesn't say "we no longer need ETag / no fs.watch caching / LOC target retracted" out loud. Not a gap, just wording debt.
- **All 10 forgotten-work items** are absorbed.

---

## 4. Special attention — the ANSWER DELIVERY LOOP (top finding)

**Requirement.** When the owner clicks an option (or types a custom answer, or clicks "apply manifest rule X") in the web UI, that answer must reach the agent that posed the question. Owner requirement R1 explicitly names blocking questions; some questions BLOCK the asking agent's next move.

**What the architecture describes.**

1. Client: `POST /actions/questions/answer` with body `{qid, answer_text}` (implied — no zod schema in the doc).
2. Server: Bearer + Origin + Host + `withTimeline("questions.answer", …)`.
3. Spawn: `bash tools/lab/lab-emit.sh answer --re <qid> --text <answer_text>` (target-arch:679).
4. `lab-emit.sh` appends a patch record to `docs/lab/questions/queue.jsonl` + writes a semantic event via `lab-log.sh`.
5. Rev.2 dual-write path: the server also INSERTs into `questions` (row updated to `status='answered'`) and into `events`.
6. In-process `EventEmitter` fires → SSE to every connected browser (so **the browser** learns immediately).

**What is not described anywhere.** Steps 7+: how does the answer reach the agent?

The architecture is completely silent on this. Every finding-file, the red-team, the PRD, and the decision log discuss the *inbound* half (agent → queue) — the *outbound* half (queue → agent) is left implicit and inherited from today's habit: the next orchestrator turn or the next agent shift reads `render_bundle.json` / `queue.jsonl` and notices the answer. Latency: minutes to hours; whenever the agent's next scheduled tick happens.

**Compare with Warren (the professed template).** Warren has `POST /runs/:id/steer` — "вбрасывает сообщение, которое агент прочитает **на следующем ходу**, не прерывая текущий" (`findings/autosk-warren-ui.md:197`). The message is delivered via the run's burrow file/env; the agent's headless loop picks it up on the next turn. Rev.2 target-arch does not carry this pattern — `apps/core/src/spawn/*` has spawners for `publish.sh`, `lab-emit.sh`, `tick.sh`, `chronicler.sh`, and **no** spawner or file-drop that injects an answer into an agent's context on the next hook.

**End-to-end latency today (after full migration, best case).**

```
Owner click → HTTP 200 (10-50 ms; TouchID adds ~1 s if enabled)
            → INSERT questions/events (5 ms)
            → SSE to browsers (10 ms) ✓ browser updates in near-second
            → agent notices? Only when the agent voluntarily reads state
              — next tool call that triggers the lab-log hook (highly variable,
              from seconds to minutes) or its next scheduled tick.
```

For non-blocking questions this is fine — matches PRD Phase 3 semantics. **For blocking questions (kind='BLOCKER'), the loop is not closed.** The agent that posted the question and then handed off / finished a turn will only "see" the answer on the next shift; there is no wake-up, no notification file, no PreToolUse-fed injection.

**Verdict.** **Loop not closed end-to-end.** This is the single largest architectural gap relative to the owner's 2026-08-06 requirements, and it is present even though Warren is the professed template and Warren has exactly this pattern.

**Proposed fix (a new Jira task, «GSL-XXX — Answer-to-agent steer channel»).**

1. Add a file drop `docs/lab/questions/answered/<qid>.json` written on every `POST /actions/questions/answer` (via `lab-emit.sh` — a two-line append writing the answer alongside the patch record). Idempotent — the file's mere existence is the signal.
2. Add a PreToolUse hook (`tools/hooks/answer-inject-hook.sh`) matching `.*` that, on each tool call from an agent, checks `docs/lab/questions/answered/` for any `<qid>` this agent (identified via `CLAUDE_SESSION_NAME`) is known to be waiting on (list maintained by the same `lab-emit question` that records the ask). If a match is found, the hook prepends a stderr line "OWNER ANSWERED question q-…: <answer>" and moves the file to `docs/lab/questions/answered/consumed/`. Claude Code surfaces stderr to the model — cheap, no context spend when no answer is pending.
3. Optional (nicer): a Warren-style `POST /actions/agents/:name/steer` for the orchestrator to relay the answer as a `SendMessage` on the agent's session (uses the same message channel the orchestrator already uses).
4. Acceptance: an agent posts a BLOCKER question → owner answers via the web → within one tool call (≤ few seconds) the agent's next model input includes the answer.

This fix is small (½-1 day) and closes the top gap. It should be added to the epic before implementation starts.

---

## 5. Internal contradictions and stale content

### Blocking staleness

**S1. `docs/reports/web-harness-research-2026-08-03/index.html` still recommends "variant A".**

- Line 731: «Из трёх реалистичных вариантов рекомендуем <strong>вариант A</strong>: тонкий …».
- Lines 866-1174: whole «3. Три варианта для нас» section, «сравнение вариантов», «`state` — разбивка сроков варианта A», the concluding CTA `Утвердить вариант A и запустить работы по эпику GSL-XXX`.
- Owner decision `d-2026-08-03-004` (2026-08-03T14:37Z) **superseded** variant A in favour of the Warren-model (revision 2 architecture, SQLite as source of truth).
- Effect: anyone opening the report's index sees the recommendation the owner rejected on the same day. Any reviewer, red-teamer, or new worker referring to that page will be misled.
- Fix: regenerate `index.html` from `target-architecture.md` revision 2 (or add a prominent banner «Superseded by target-architecture.md rev.2 (owner decision d-2026-08-03-004). Read that instead.»). Rename the folder from `web-harness-research-2026-08-03` to something less confusing (`web-harness-decisions-2026-08-03`) is optional.

### Wording drifts (minor)

**S2.** `target-architecture.md:36` still lists the JSONL ↔ SQLite double-period as «главный нерешённый риск», while §12 R26 explicitly claims mitigation. Statement of "unsolved" contradicts the closed risk row — decide one or the other.

**S3.** `target-architecture.md:649` describes an ORCHESTRATION-STATE addition with the word «гlbинается» (typo for "гасится"?). Cosmetic, but a live standing-rule paragraph should be lint-clean before it lands.

**S4.** `target-architecture.md:923` misspells «Bearer из-за regex-баг» — «Bearer из-за regex-баг» is fine, but the row talks about middleware while §7 talks about Keychain — pick a single label.

### Cross-reference contradictions

**C1. `publish.sh` origin.** GSL-266 description says «publish.sh (from GSL-253)». GSL-250 epic body says «Alignment with epic GSL-174. Step 7 of the plan — the first "Publish skill" write button — assumes `tools/skills/publish.sh` and `docs/skills/CHANGELOG.jsonl` from epic GSL-174 (stages 2 and 3) are ready». Both are correct (GSL-253 is under GSL-174), but reading GSL-266 alone one would look for GSL-253 as a sibling of GSL-250 — it is under a different epic. Add a sentence «GSL-253 lives in the parent epic GSL-174» to avoid confusion.

**C2. `GSL-269 Docs task** describes a smoke check «`grep -R fs.writeFile apps/core/src/routes/actions.ts apps/core/src/spawn/ apps/core/src/security/` — 0», but §5.3 rule 1 says «`find apps packages -name '*.py'` = 0; `find apps packages -name '*.sh'` = 0» — the two rulesets overlap without cross-reference; consolidate the guard list in one place (either the task or the architecture, not both).

**C3. `GSL-263 read endpoints list** includes `/cost` and `/fleet`; `target-architecture.md:277` includes them too, but §4.3 schema does not define any `cost` or `fleet` table — the projection has no data model. `/cost` probably comes from existing `docs/lab/{cost-daily,cost-weekly,cost-monthly}.json` outputs; `/fleet` from `heartbeat` + `claude agents --json`. Not spec'd. Either add data-model rows to §4.3 or annotate the endpoints «projected from external files/CLI».

**C4. `GSL-267 dual-write hook** claims «`POST /internal/emit` (env-secret only, 127.0.0.1 only, protection separate from Bearer)», but §7 (auth) does not treat `/internal/emit` as its own layer — no test for it in GSL-264, no key derivation described. Add a paragraph.

---

## 6. Coverage matrix — architecture ↔ Jira task ↔ migration step

Sanity check that every step of §9 (steps 1-12) has a Jira task and vice versa.

| Migration step | Description | Jira task | Notes |
|---|---|---|---|
| Step 0 | Preact-SSG works | — (baseline) | — |
| Step 1 | Skills-governance prerequisites | Out of scope — belongs to GSL-174 (cross-ref in GSL-250 body) | OK |
| Step 2 | Chronicler top-level lock + web sentinel | GSL-259 | OK |
| Step 3 (part 1) | Monorepo skeleton | GSL-258 | OK |
| Step 3 (part 2) | Core skeleton, launchd, healthz | GSL-260 | OK |
| Step 4 (part 1) | Drizzle schema + migrations + snapshot | GSL-261 | OK |
| Step 4 (part 2) | JSONL import | GSL-262 | OK |
| Step 5 | Tail indexer + read endpoints + SSE | GSL-263 | OK |
| Step 6 | React client, 5 read-only screens | GSL-265 | OK |
| Cross-cutting | Layered auth (Keychain + TouchID + withTimeline + persistent idempotency) | GSL-264 | Not in §9's step numbering; carved out as its own task — good call |
| Step 7 | First write button (Publish) | GSL-266 | OK |
| Step 8 | Dual-write hooks | GSL-267 | OK |
| Step 9 | Answer/tick/ack/resolve | GSL-268 | OK — **but Q: no defer, no manifest-apply — see §2 R2** |
| Step 10 | Polish + docs + smoke | GSL-269 | OK |
| Step 11 | Deprecate Preact-SSG | GSL-270 | OK |
| Step 12 | Final switch (SQLite = SoT) | GSL-271 | OK |
| Step 13 | Cleanup (`git rm`) | Out of epic (explicit) | OK |

**Result.** All 12 steps in scope are covered. 14 tasks, 12 steps, one cross-cutting task — clean.

---

## 7. Ranked gap list with proposed fix

**Ranking rule:** if the gap silently breaks an owner requirement or the answer-delivery loop → high; if the gap is an internal contradiction or wording drift → medium; if the fix is a "phase 2 note" → low.

### High

1. **G1. Answer-delivery loop to active agent is not closed.** See §4. **Fix:** new task «Answer-to-agent steer channel» (file-drop or SendMessage bridge + PreToolUse hook). ½-1 day. **Blocking for R1/R2 semantically.**
2. **G2. Decision-manifest lookup and rule provenance are missing from the data model and UI.** R1's third sub-clause + R2's fourth sub-clause. **Fix:** add `questions.applied_by ENUM('owner','manifest','orchestrator')` + `questions.applied_rule_ref TEXT`; new endpoint `POST /actions/questions/apply-manifest {qid, rule_ref}` (spawns the same `lab-emit answer` with `--src=manifest --rule=<ref>`); render the badge + hoverable rule text in the Questions screen. 1 day.
3. **G3. Per-agent fleet view — required by R4 — has no data model.** **Fix:** new task «Fleet: PreToolUse emit + `agents` table + `/fleet` projection + fleet screen». 1.5-2 days. Reuses GSL-212 output. This is the most owner-visible improvement over the "5 read-only screens" of GSL-265.
4. **G4. `defer` action for a question is missing (R2).** **Fix:** extend `questions.status` enum, add `/actions/questions/defer` endpoint, add UI button. ½ day.

### Medium

5. **G5. Jira reconciler in `gosleep-core` is not spec'd (R6).** **Fix:** new task «Jira reconciler + `/actions/tasks/sync`». 1-1.5 day (uses Atlassian MCP or direct REST + Keychain-stored token).
6. **G6. `/fleet` and `/cost` endpoints listed without data model.** See C3. **Fix:** add §4.3 rows or annotate «projected from external file/CLI».
7. **G7. Night-mode non-blocking guarantee is implicit, not asserted (R3).** **Fix:** smoke assertion in GSL-269.
8. **G8. `POST /internal/emit` auth layer is undocumented.** See C4.
9. **G9. `index.html` still recommends variant A (stale).** See S1. **Fix:** regenerate or banner.
10. **G10. Internal contradiction §12 R26 vs §1 «главный нерешённый риск».** See S2. **Fix:** one-line edit.

### Low

11. **G11. Provider abstraction (R7) not acknowledged.** **Fix:** add a §13 «Deferred: provider adapter interface» with a two-paragraph sketch. 30 min.

---

## 8. Positive findings (what rev.2 does well)

Worth capturing so we know what to preserve:

1. **All 3 critical + all 5 major red-team findings are closed with a Jira acceptance line each.** Rev.2 is a real response to the red-team, not a rewrite that ignored it.
2. **Layered auth (Bearer in Keychain + TouchID + Host + Origin + env-secret in spawn) is the strongest part of the plan.** It closes the "agent under owner UID publishes a skill" hole that critical #1 named, and it does so with an industry-standard construction (analog of gh CLI + 1Password + Warren).
3. **Migration steps 1-12 are all covered by a Jira task each (with a security cross-cutting split-out).** The step ↔ task mapping is clean.
4. **SSE + `Last-Event-ID` + `event: rotate` for UTC-day change** — small change, closes major #5 elegantly.
5. **Persistent idempotency + `withTimeline` + `server_intents`** — good triple, closes major #6 and enables orphan reconcile after crashes.
6. **JSONL as historical archive with idempotent one-off import** (GSL-262 / target-arch §4.5) — the pivot from "JSONL as SoT" to "SQLite as SoT" is done without losing history and without a big-bang cutover.

---

## 9. Recommendations to the orchestrator (short)

Before starting the epic:

1. Add tasks **G1–G4** to GSL-250 as new sub-tasks (highest priority: G1 answer-delivery + G3 fleet).
2. Add tasks **G5–G6** (medium; probably fit between step 9 and step 10).
3. Regenerate or banner `index.html` (**G9**) — 10 minutes, prevents a common misreading.
4. Consider adding a short §13 to `target-architecture.md` on provider abstraction (**G11**) — will save an epic-scope debate in phase 2.

After starting the epic:

- GSL-263 acceptance for "near-second updates" should include an end-to-end timing test (owner clicks → agent sees) once G1 lands.
- Consider making the Questions screen (GSL-265) explicit about the BLOCKER badge.
- Track `applied_by = 'manifest'` growth in the timeline weekly digest — it's the visible metric that the manifest loop is actually working.

---

## Appendix A — quick reference

- **Owner requirements source:** decision log `docs/lab/decisions/log.jsonl` entries `d-2026-08-03-004` (Warren-model), `d-2026-08-03-006` (SQLite=SoT), `d-2026-08-03-007` (live-UI requirements), restated by the owner on 2026-08-06.
- **Object of audit:** `docs/reports/web-harness-research-2026-08-03/target-architecture.md` (rev.2, 974 lines).
- **Red-team:** same folder, `redteam-verdict.md` (3 critical + 5 major + 6 minor + 10 forgotten works).
- **Jira epic:** GSL-250 with 14 tasks GSL-258…GSL-271 (all `To Do` as of 2026-08-06); parent-epic cross-refs GSL-174 (`publish.sh` and CHANGELOG registry), GSL-212 (`claude agents --json`).
- **PRD phases relevant here:** Phase 3 «Question buffer + decision manifest + morning digest» (`PRD-gosleep-evolution.md:323-405`) — the source of the manifest concept the target-arch dropped; Phase 5 (old interactive dashboard) is explicitly superseded by the new epic.

**End of report.**
