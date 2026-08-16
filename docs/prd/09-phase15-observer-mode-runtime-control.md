# PRD — Phase 15: Observer mode, part B (runtime control activation)

> **Status:** Draft — 2026-08-16 (per-phase file; second of the observer-mode program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347)
> **Source of truth for the vision:** owner briefing 2026-08-16 (verbatim: "runtime function in the UI, not a launch-time env flag").
> **Ground-truth references:** `docs/runbooks/gosleep-core.md` section 8 (today's env-at-session-start guard on both shims), `docs/lab/decisions/log.jsonl` entry `d-2026-08-08-001` (widening interception is an owner-gated act).
> **Sibling phases (this program):** `08-phase14-observer-mode-observation.md` (Phase A — passive observation, required upstream), `10-phase16-observer-mode-task-submission.md` (Phase C — task submission, gated on Phase 15 activation).
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).

---

## Positioning: activation moves from the shell prompt into the panel

Today, whether a session hands its questions and permission requests to the gosleep panel is decided at launch time. `env GOSLEEP_WEB_QUESTIONS=1 claude …` opts a session in for its entire lifetime; a session started without the flag is invisible to the interception path forever. The runbook (§ 8) is explicit about this: "the guard exits 0 in ~400 ms"; every non-opted session bypasses the panel entirely. Widening interception to all sessions is the explicit next owner-gated step (`d-2026-08-09-001` and the widening-gate note, `GSL-302`).

The owner-approved vision (2026-08-16) shifts the shape of that gate. The env flag makes sense as a bootstrap and a compatibility fallback, but the "should this session route through the panel?" decision belongs at runtime, in the panel, per session. The owner should be able to open the Observed screen (Phase 14), see a session, click **Take control**, and from that moment forward that session's `PreToolUse{AskUserQuestion}` + `PermissionRequest` events land in the gosleep queue instead of the local TUI dialog. The owner should equally be able to click **Release control** on that same session and have interception cease within one poll cycle — with the TUI dialog rendering for the next event as if the session had never been opted in.

Activation **is** the owner command that `d-2026-08-08-001` requires. This PRD reframes the decision-log entry explicitly: "widening interception only by an owner command" holds; the owner command is now delivered per-session through the panel rather than by editing a shell rc file. The rule does not soften — it moves from a coarse-grained shell-wide gesture to a fine-grained per-session gesture with better audit.

Phase 15 does not touch which sessions are **observed** (that is Phase 14's job, and observation is always on for every discoverable Claude session). Phase 15 only decides which observed sessions are **controlled**. The default is unchanged: no session is controlled unless the owner picks it.

---

## Goal

The owner sees a per-session control state on every Fleet card and on every Observed card: **observer** (default), **controlled** (owner-activated). A "Take control" affordance appears on any card where the observed session has the runtime-toggle-aware shim installed (see Scope) and the current state is `observer`; clicking it flips the state to `controlled` within a poll cycle, and from that point the session's `AskUserQuestion` + `PermissionRequest` events route to the gosleep queue exactly as sessions with `GOSLEEP_WEB_QUESTIONS=1` do today. A "Release control" affordance on `controlled` cards flips the state back; the next event on that session renders the local TUI dialog as if it were a fresh non-opted session. Every activation / deactivation writes a `control.taken` / `control.released` event to the timeline with `session_id`, `by=owner`, `channel=web`, and the current `applied` shim signature; the audit trail lets the owner reconstruct which sessions were under panel control at any historical timestamp. The env-flag path stays wired as a compatibility fallback: a session started with `GOSLEEP_WEB_QUESTIONS=1` is in `controlled` state from birth and cannot be released to `observer` (owner would have to close and re-open the session under a shell that does not export the flag).

---

## Scope

| In | Out (and why) |
|---|---|
| **Per-session control registry** in the core: new table `session_control` (columns `session_id`, `state` enum `observer|controlled`, `activated_at`, `activated_by`, `deactivated_at`, `source` enum `env|runtime|inherited`). Written by two paths only: (a) the shim on session start writes `source='env'` if `GOSLEEP_WEB_QUESTIONS=1` else does nothing, (b) the runtime toggle endpoint writes `source='runtime'`. Read at every long-poll dispatch to gate interception. | A global "everything on / everything off" master switch — the whole point is per-session. |
| **Runtime-toggle-aware shim** — a small addition to `tools/hooks/ask-user-question-hook.sh` and `tools/hooks/permission-request-hook.sh`: the shim's first executable line becomes a compound gate — enter the long-poll if EITHER `GOSLEEP_WEB_QUESTIONS=1` (compat) OR the core's `GET /internal/sessions/:session_id/control` returns `{state:"controlled"}`. Guard state is fetched once at the top of the shim (fast, in-process cache with 1 s TTL); if the core is unreachable, fall back to the env flag alone. Shim guard stays the very first thing that runs, so the "not interested" cost is one HTTP request to `127.0.0.1:7331` (bounded ~5 ms) instead of ~400 ms of shim boot. | Modifying the observed project's shim wiring. This phase covers the two shims wired in this repo's `.claude/settings.json` (and, by transitive install, any project that copies them or later gets them via a plugin — see § dependencies). Observed sessions in projects without the shim wired stay `observer` forever, and the "Take control" affordance is disabled with a tooltip explaining why. |
| **Control endpoints (write side)** — `POST /actions/sessions/:session_id/take-control` and `POST /actions/sessions/:session_id/release-control`. Both use the standard three-layer envelope: `requireBearer`, `serialize("session.control", session_id)`, `withTimeline` (event kinds `control.taken` / `control.released`). Idempotent by session-id + owner-supplied nonce (the panel generates one per click). Refuses `session_id` values not present in `claude_sessions` (404) and refuses `take-control` on a session whose shim did not register (409 with reason). | Bulk control transitions (a "take control of all sessions in this project" macro) — surface is not designed for that, and it would collide with the "per-session, deliberate" framing. |
| **Control endpoint (read side)** — `GET /sessions/:session_id/control` returns `{state, source, activated_at, activated_by, shim_registered}`. The `shim_registered` bit is populated when a session's first shim invocation POSTs a heartbeat to `/internal/sessions/:session_id/shim-heartbeat` — the panel uses it to enable/disable the "Take control" button. `GET /sessions?state=controlled` filters. SSE topic `sessions.control.*` invalidates the TanStack Query cache within one round-trip. | Cross-machine control ("take control of a session on the other laptop") — Remote Control (Phase 6) is the surface for that; this phase is host-local. |
| **UI: state pill + toggle** on every Fleet card and every Observed card. Three visual states — `observer` (muted "eye" glyph), `controlled` (accent "hand" glyph), `env-locked` (padlock glyph, tooltip "session started with GOSLEEP_WEB_QUESTIONS=1; release by restarting the session in a shell that does not export the flag"). "Take control" button on `observer` cards where `shim_registered=true`; "Release control" on `controlled` cards where `source='runtime'`; disabled with tooltip on `source='env'` (`env-locked`) and on `shim_registered=false` (`observer` cards without shim). | Any UI that hides the state — the state pill is always visible, always the same shape, so the owner can never doubt which sessions the panel can act on. |
| **Timeline audit** — `control.taken` / `control.released` events with the full payload (state, source, activated_by, activated_at, shim_signature). Renderable in the existing Timeline screen; searchable via the existing filters. Owner memory `no-silent-default-decisions.md` (2026-08-08) applies: no automatic activation, no timer-based transitions, no "if you don't answer the toast in 30 s we'll de-activate for you". | Programmatic activation from other services (Jira automation, cron) — activation is always an owner gesture in v1. |
| **Compatibility path** — `GOSLEEP_WEB_QUESTIONS=1` continues to work exactly as it does today: a session launched with the flag registers `state=controlled, source='env'` on its first shim invocation; the panel cannot release it (as noted above); no owner action is required to keep the pilot pattern from § 8 of the runbook alive during roll-out. | Removing the env flag path — kept forever as the bootstrap that survives a core outage; the compound-OR shim gate is designed around that. |
| **Owner-gate reframing note** in the runbook — a two-paragraph addition to `docs/runbooks/gosleep-core.md` § 8 that names the runtime toggle as the current owner-command surface for widening (`d-2026-08-08-001`), with the env flag flagged as legacy-bootstrap. This PRD lists the note as a required deliverable so the runbook and the code don't drift. | Editing `d-2026-08-08-001` itself — the decision remains as-written; the new PRD is the reframing surface. |

---

## Success criteria

- **F15-S1 (state registry).** Boot the core; start a `claude` session inside this repo *without* the env flag; observe on the Fleet screen a card with pill `observer` and disabled "Take control" until the first shim invocation lands (the session's shim must POST a heartbeat to `/internal/sessions/:session_id/shim-heartbeat`); click "Take control"; verify `session_control` row transitions to `state=controlled, source='runtime'` within 1 s; verify the SSE `sessions.control.taken` event lands; verify the Timeline screen shows the row with `by=owner, channel=web`.
- **F15-S2 (interception starts on activation).** In the same session, invoke `AskUserQuestion`; verify the shim reads `state=controlled` from the in-process cache; verify the question lands in the gosleep queue (row in `questions` with `kind=BLOCKER`, `qid=q-…`) exactly as a today-with-env-flag session would; answer from the panel; verify the shim's long-poll releases and the agent proceeds.
- **F15-S3 (release stops interception instantly).** Click "Release control" on the same card; verify state transitions to `observer`, `source='runtime'`, `deactivated_at` populated; invoke `AskUserQuestion` again; verify the shim's guard returns fast (miss the long-poll) and the TUI dialog renders locally exactly as a non-opted session; verify no row landed in `questions`.
- **F15-S4 (env-flag compat unchanged).** Start a second session with `env GOSLEEP_WEB_QUESTIONS=1 claude …`; verify the card renders with pill `env-locked` (padlock glyph, disabled release button + tooltip); verify `AskUserQuestion` on this session routes through the panel identically to today's pilot; verify "Release control" is not reachable via keyboard focus.
- **F15-S5 (permission events).** Repeat F15-S2 and F15-S4 for `PermissionRequest` (real event, `GSL-304` surface): verify runtime-activated sessions route to `/actions/permissions/decide` and env-flag sessions continue to route to the same endpoint, both indistinguishable in the panel's permission dialog.
- **F15-S6 (safety rails).** Verify `POST /actions/sessions/:session_id/take-control` on a session with `shim_registered=false` returns 409 with a JSON body naming the reason; verify calling it on an unknown `session_id` returns 404; verify a double-click on "Take control" is idempotent via the panel-generated nonce (no second `control.taken` event); verify calling `release-control` on an `env-locked` session returns 409 with a "session is env-locked; restart in a shell without the flag" body.
- **F15-S7 (verification-report proof).** The scenarios above are recorded end-to-end as an HTML report EN+RU under `docs/reports/verifications/GSL-347/runs/02/index.html`. The report cites the timeline audit rows for every activation/deactivation as evidence of the owner-gated framing, and demonstrates F15-S3's fast-release path with a stopwatch overlay showing the sub-second interception cutover.

---

## Requirements

- **R15.1 — Activation is a per-session, deliberate owner gesture.** No path anywhere activates control automatically. No timer-based transitions. No global master switch. If the owner never clicks "Take control" on a session, that session is `observer` for its whole lifetime. Acceptance: F15-S1, F15-S6.
- **R15.2 — Release is instant on the next event.** Cutover latency from click-to-not-intercepted is bounded by the shim's in-process cache TTL (1 s); the next `AskUserQuestion` / `PermissionRequest` after release does NOT route through the panel. Acceptance: F15-S3.
- **R15.3 — Compatibility with the env-flag path is preserved forever.** The env flag remains as the bootstrap and the outage-fallback; env-locked sessions render distinctly and cannot be released from the panel. Acceptance: F15-S4.
- **R15.4 — Every activation and deactivation is audited on the timeline.** `control.taken` / `control.released` events include enough fields to reconstruct which sessions were under panel control at any historical timestamp. Acceptance: F15-S1, F15-S3.
- **R15.5 — The runbook reframes `d-2026-08-08-001` in-line.** `docs/runbooks/gosleep-core.md` § 8 gains a two-paragraph reframing note: "activation is the owner command; the runtime toggle is the current surface; env flag is legacy bootstrap." Acceptance: reviewed at merge time of the implementation epic.
- **R15.6 — Shim gate cost stays bounded.** The compound-OR shim gate adds at most one 5 ms `127.0.0.1` HTTP request to the shim boot in the miss path; on core-unreachable, falls back to the env flag alone within 100 ms. Acceptance: F15-S3 (miss path proves fast).
- **R15.7 — Only sessions with a registered shim can be controlled.** The panel refuses "Take control" on sessions whose shim never checked in — otherwise activation would be a lie (state flipped, but events keep going to the TUI). Acceptance: F15-S1, F15-S6.

---

## Tasks (epic `[Docs][Web] Observer-mode PRD (phases A-C)`, [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347))

Same PRD-delivery split as Phase 14 — [GSL-348](https://ainstance-labs.atlassian.net/browse/GSL-348) writes this file, [GSL-349](https://ainstance-labs.atlassian.net/browse/GSL-349) wires the traceability rows. The implementation decomposition below is for the future implementation epic.

1. **Schema + migration** — `session_control` table + Drizzle migration + `packages/schema` types.
2. **Shim compound-OR gate** — extend `tools/hooks/ask-user-question-hook.sh` and `tools/hooks/permission-request-hook.sh` to consult `/internal/sessions/:session_id/control` (in-process cache, 1 s TTL, env-flag fallback on unreachable core). Preserve today's fast-exit shape.
3. **Shim heartbeat** — first shim invocation POSTs `/internal/sessions/:session_id/shim-heartbeat` so the panel can populate `shim_registered`.
4. **Control endpoints (write side)** — `POST /actions/sessions/:session_id/take-control` and `/release-control`, both under the three-layer envelope with `control.taken` / `control.released` timeline events.
5. **Control endpoints (read side)** — `GET /sessions/:session_id/control`, `GET /sessions?state=controlled`, SSE topic `sessions.control.*`.
6. **UI state pill + toggle** — extend Fleet cards and Observed cards with the three-state pill + Take/Release buttons and the disabled-tooltip surface for `env-locked` and `shim_registered=false`.
7. **Runbook reframing note** — two paragraphs in `docs/runbooks/gosleep-core.md` § 8 per R15.5.
8. **Live verification run** — `docs/reports/verifications/GSL-347/runs/02/index.html` (EN + RU) recording F15-S1..F15-S6 with the stopwatch overlay for F15-S3.

---

## Non-goals (explicit)

- Global master switch to control everything at once — the surface is per-session by design.
- Automatic activation triggered by heuristics ("this session started answering machine-safety questions, auto-activate control") — no; activation is always an owner gesture.
- Removing the env-flag path — kept forever as the outage-fallback.
- Cross-machine control — Remote Control (Phase 6) surface, not this one.
- Programmatic activation from Jira automations, cron, or other services — v1 activation is always an owner gesture.
- Any interception of an observed session in a project without the shim installed — those cards stay `observer` forever, "Take control" is disabled with a tooltip.
- Editing the observed project's hook wiring — the shim must already be there (whether installed loose, by the current `install.sh` path, or later by the `gosleep-orchestration` plugin from the migration program).

---

## Dependencies

- **Phase 14** (observer-mode observation) — Phase 15 needs the `claude_sessions` + tmux map + Observed screen to have cards to attach the state pill to.
- **Phase 7 web control plane** (GSL-250) — the three-layer write envelope, the SSE broadcaster, and the AppShell surface where Fleet / Observed live.
- **`d-2026-08-08-001` and `GSL-302` widening-gate note** — this PRD reframes those in-line and requires the runbook update per R15.5.
- **Plugin migration program** (`03-phase9-plugin-orphan-rescue.md` … `07-phase13-plugin-e2e-shakedown.md`, epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)) — *note only*: the runtime-toggle-aware shim is a natural candidate to ship inside the future `gosleep-orchestration` plugin so a fresh machine can be brought under panel control without hand-editing `.claude/settings.json`. Neither program depends on the other — the runtime toggle works today for the two shims wired in this repo, and expansion to plugin-delivered shims is a v1.1 line item under the plugin program.
- **Owner memory `no-silent-default-decisions.md`** (2026-08-08) — no auto-timer, no default-if-silent transitions in this phase.

---

## Risks + open questions

- **Risk 1: In-process cache TTL vs release latency.** A 1 s TTL bounds release latency to 1 s from the shim's perspective; a faster TTL would mean more `127.0.0.1` traffic; a slower TTL would extend the release cutover. *Mitigation:* declare as a config knob (`session.control.shim_cache_ttl_ms`, default 1000). Question: is 1 s the right default, or is 500 ms safer for owner expectations?
- **Risk 2: Session-id opacity.** Claude Code's session id is stable for the life of the session but hard to correlate to a tmux pane by eye. *Mitigation:* the state pill lives on the Fleet card (which already resolves session-id → pane), never on a raw session-id row.
- **Risk 3: Shim can't reach the core (network partition, port collision, core crashed).** *Mitigation:* compound-OR falls back to the env flag alone; the shim still fires. A `control_check_failed` log line is emitted. Question: on core-unreachable, is the fallback "env-flag only" (safe default: uncontrolled sessions stay uncontrolled) or "last-known-good state" (controlled sessions stay controlled through a partition)? Recommended default: env-flag only — the owner can re-take control after core recovery, which is a cheaper failure mode than accidentally staying in interception when the panel is unreachable.
- **Risk 4: A session's shim registers on the wrong `session_id`.** Claude Code sometimes reissues session ids across resume; the shim's heartbeat could point at a stale id. *Mitigation:* heartbeat carries the `session_id` from the current invocation; the panel uses the latest heartbeat per pid to resolve which id is live. Question: how often does the owner hit resume-mid-session in normal flow? (If often, add a "stale heartbeat" warning on cards with heartbeat older than 5 min.)
- **Risk 5: Env-locked cards are confusing.** Owner sees a padlock and no way to release; the tooltip is the only surface that explains why. *Mitigation:* tooltip text is deliberate ("session started with `GOSLEEP_WEB_QUESTIONS=1`; release by restarting in a shell without the flag"); the padlock glyph is standard.
- **Risk 6: Take-control endpoint 409 on `shim_registered=false` is invisible until the user tries.** *Mitigation:* the button is disabled with a tooltip on `shim_registered=false` cards; the 409 is a defence-in-depth path, not the primary UX.
- **Risk 7: Concurrent take/release from two panel tabs on the same session.** *Mitigation:* per-session `serialize("session.control", session_id)` + idempotency by nonce ensures the second click either replays or superseeds cleanly; SSE broadcasts converge both tabs.

Morning-digest questions (with recommended defaults):

- **Q1.** Shim cache TTL default (500 ms vs 1 s)? → **default:** 1 s.
- **Q2.** Core-unreachable fallback (env-flag-only vs last-known-good)? → **default:** env-flag-only.
- **Q3.** Should the panel expose a "temporary auto-release after N minutes of no owner attention" option? → **default:** no in v1 — memory `no-silent-default-decisions.md` argues against.
- **Q4.** Should env-locked cards render a `stop-flag-and-restart` shortcut? → **default:** no — that would require the panel to kill/restart a session which crosses the observer/control seam.

---

## Sources

- Owner briefing 2026-08-16 (verbatim: "runtime function in the UI, not a launch-time env flag") — captured in the [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347) epic description.
- `docs/runbooks/gosleep-core.md` — section 8 (question-loop pilot, env-guard shape, widening-gate note); section 8.5 (Bearer discovery for the panel).
- `docs/lab/decisions/log.jsonl` — `d-2026-08-08-001` (widening interception only by owner command); `GSL-302` widening-gate note captured in the runbook.
- `docs/prd/01-phase7-interactive-control-plane.md` — Phase 7 R7.2 (answer path) and the three-layer write envelope.
- `docs/prd/08-phase14-observer-mode-observation.md` — the observation surface Phase 15 builds on.
- `docs/prd/10-phase16-observer-mode-task-submission.md` — task submission gated on Phase 15 activation.
- `docs/prd/03-phase9-plugin-orphan-rescue.md` … `07-phase13-plugin-e2e-shakedown.md` — the plugin migration program; noted here as the future delivery path for the runtime-toggle-aware shim on machines without loose hooks.
- Owner memory `no-silent-default-decisions.md` (2026-08-08) — the "no auto-transitions" rule that R15.1 implements.
- Owner memory `web-verification-html-runs.md` (2026-08-10) — the HTML-report EN+RU convention that F15-S7 satisfies.

---

*End of Phase 15 PRD (Observer mode part B — runtime control activation).*
