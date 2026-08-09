# Web control plane — feature-complete gap analysis (2026-08-09)

> **Author:** worker `plan-webfc` (READ-ONLY planner), shift 76 kick-off.
> **Purpose:** determine what stands between `main` @ `56f57d1` and Phase 7 "Feature Complete", and propose the next epic breakdown.
> **Source of truth order:** owner decisions > `docs/prd/01-phase7-interactive-control-plane.md` > `target-architecture.md` rev 2 + rev-3 addendum > run-02 verification payload > merged code > Jira.
> **Not committed.** Report file is untracked scratch, plan input only.

---

## 1. Feature Complete definition — PRD Phase 7 requirements coverage

Phase 7 acceptance criteria after the 2026-08-08 re-scope are seven owner requirements (R7.1..R7.7) plus a live end-check ("Acceptance criteria + end-check" section of the PRD). Below each item is mapped to shipped evidence on `main` @ `56f57d1`.

| ID   | Requirement (short)                                                                        | Status     | Evidence                                                                                                                                                                                                                                                                          |
|------|--------------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| R7.1 | Real-time question window, blocking status, manifest-rule provenance                       | DELIVERED  | `apps/core/src/manifest/parser.ts`; `apps/core/src/routes/actions.ts` (`apply-manifest`, GSL-277); `apps/web/src/screens/Questions.tsx` (950 lines, badge + hoverable rule text); SSE broadcast via `apps/core/src/sse/`. Run 02 finding 5..7 hold.                                    |
| R7.2 | Web answer: pick / custom / defer / apply-manifest + delivery to the agent                 | DELIVERED  | Four button variants in `Questions.tsx`; `POST /actions/questions/{answer,defer,apply-manifest}` in `actions.ts`; delivery via blocking `PreToolUse{AskUserQuestion}` shim + `GET /internal/questions/:qid/answer-wait` (long-poll) in `apps/core/src/routes/internal.ts`. GSL-274 smoke PASS (5/5) recorded in `docs/dev_history/GSL-274-web-answer-loop-smoke.md`. |
| R7.3 | Night mode: questions accumulate, agents do not stall                                       | DELIVERED  | `POST /internal/questions/post` is fire-and-forget from the agent's viewpoint (immediate 200); answer arrives via next `AskUserQuestion` tool call over the long-poll. Documented in `internal.ts` header. Guarded pilot (`GOSLEEP_WEB_QUESTIONS=1`) currently sole activation path per `.claude/settings.json:100`. |
| R7.4 | Fleet view: how many agents, what each is doing, context %                                  | PARTIAL    | `apps/core/src/db/schema.ts` `agent_sessions` table + `workers/fleet-poll.ts` poll of `claude agents --json` + `apps/web/src/screens/Fleet.tsx` cards + `apps/core/src/adapter/model-resolver.ts` (model resolved from settings hierarchy). Shipped. **Gap:** `current_tool` / `context_pct` populate only when the `PreToolUse` shim fires in a session, i.e. only under the guarded pilot. Run 02 finding 6 rendered them as honest "unknown" pills, never demonstrated populated live values in a real session. |
| R7.5 | Near-second live updates via SSE (not polling)                                             | DELIVERED  | `apps/core/src/routes/events.ts` + `apps/core/src/sse/` broadcaster; `Last-Event-ID` + `event: rotate` at UTC rollover; Timeline SSE consumed by `apps/web/src/screens/Timeline.tsx`.                                                                                              |
| R7.6 | Tasks view + Jira sync                                                                     | DELIVERED  | `apps/core/src/workers/jira-sync.ts` (5-min cadence) + `POST /actions/tasks/sync` in `actions.ts` (GSL-279) + `apps/web/src/screens/Tasks.tsx` (last-sync timestamp).                                                                                                              |
| R7.7 | Provider abstraction — SessionAdapter seed                                                  | DELIVERED  | `packages/runner-adapter/{index.ts, session-adapter.ts, claude-code.ts, contract.md}`; `apps/core/src/adapter/session.ts` imports through the seam; `getSessionAdapter()` used by `actions.ts`. `.md` sketch not required for feature complete (owner may confirm on epic close).   |

Additional PRD end-check bullets not part of R7.x:

| Bullet                                                                                                             | Status     | Evidence                                                                                                                                                             |
|--------------------------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| "Opens `http://127.0.0.1:7331` in Safari/Chrome on the MacBook, sees live Overview with runway and Fleet."         | DELIVERED  | `apps/core/src/routes/spa.ts` mounts `apps/web/dist/`; runway tile in `Overview.tsx` (GSL-289) and Fleet cards (GSL-290).                                              |
| "Answers a real agent question through the web (the agent sees the answer within one tool call)."                  | PARTIAL    | Loop shipped; owner-facing setup path (`plist.sh setup-url` + `/setup?tok=<otp>`) shipped (GSL-291). NOT PROVEN LIVE end-to-end with a real fleet agent in a doc-of-record. Handoff 57 lists this as a backlog seed. |
| "Takes a manual snapshot through a button."                                                                        | MISSING    | `apps/core/scripts/snapshot.sh` exists and the launchd cron runs it at 04:00 local, but no `POST /actions/snapshot` endpoint and no UI button. Overview.tsx has no snapshot control. |
| "Preact-SSG stops being invoked by the chronicler (`GOSLEEP_KEEP_STATIC_SITE=0`)."                                 | EXCLUDED   | GSL-271 (final SoT switchover); soak-gated 30-60 days per owner decision `d-2026-08-09-001`. Explicit exclusion per this brief.                                       |
| "`mobile/README.md` continues to work via GitHub rendering (Phase 5 archive-mode)."                                | DELIVERED  | Phase 5 archive-mode intact; `docs/lab/mobile/README.md` unchanged.                                                                                                    |

**Totals against Phase 7 acceptance:** 6 of 7 R7.x DELIVERED, 1 PARTIAL (R7.4 sub-fields not proven live). End-check: 3 DELIVERED, 2 PARTIAL, 1 MISSING (snapshot button), 1 EXCLUDED.

**Verification baseline.** `docs/reports/verifications/GSL-250/runs/02/payload.json` — score 100, all fixes hold, zero remaining CRITICAL/MAJOR/MINOR against the post-rescope Phase 7 acceptance. The gaps below are new work relative to that scoreboard, not regressions of already-verified work.

---

## 2. Ranked gap list

Ordered by feature-complete blocking weight, most-blocking first.

### Gap 1 — Manual snapshot button (Overview) + `POST /actions/snapshot`

- **In scope because:** PRD "Acceptance criteria + end-check" names "takes a manual snapshot through a button" as an end-check step. It is the last live-write in the Phase 7 acceptance the owner has to click when dogfooding.
- **Evidence of gap:** `grep -rn snapshot apps/core/src/routes` — zero hits; `grep -rn snapshot apps/web/src` — one hit in an unrelated subtitle string. Backend `apps/core/scripts/snapshot.sh` exists and works from the shell, so this is thin wiring (endpoint + button).
- **Blast:** low (writes only to `data/snapshots/…`, not to core state); Bearer-only per `actions.ts` header comment on low-blast writes. No TouchID needed.

### Gap 2 — Live proof of the AskUserQuestion answer-loop end-to-end (owner ↔ live agent)

- **In scope because:** R7.2 and R7.3 both rest on this loop. GSL-274 smoke proved the primitive (`allow` + `updatedInput`) against a scripted session; the guarded-pilot commit `.claude/settings.json:100` (GSL-267) wires the shim to core. Shift 75 handoff explicitly lists "pilot observation of GSL-267" as a backlog seed. Without a documented live proof, R7.2's "the answer reaches the agent" and R7.3's "agent does not stall" are not verified for a real session.
- **Evidence of gap:** `docs/reports/verifications/GSL-250/runs/02/payload.json` finding 6 explicitly records `current_tool` / `context_pct` / `current_intent` staying `null` because the shim has not yet fired in the audit environment. No verification dossier under `docs/reports/verifications/` covers a real pilot session end-to-end (agent → hook → core → web → owner click → agent proceeds).
- **Blast:** none; verification-only, does not touch code unless a real bug surfaces.

### Gap 3 — Live proof of the PermissionRequest hook end-to-end

- **In scope because:** the PermissionRequest shim + `POST /internal/permissions/post` + `POST /actions/permissions/decide` shipped as GSL-284 (same guarded pilot as GSL-275). Rev-3 addendum Delta 1 §5 makes this half of the layered live-signal contract. Shift 75 handoff lists "PermissionRequest live-session proof ticket" as a backlog seed. Without a live proof, allow/deny from the web to a real tool-use prompt is not verified.
- **Evidence of gap:** `apps/core/src/routes/internal.ts` lines 599-780 implement the endpoint and the wait; `.claude/settings.json:107` wires the hook; no verification dossier covers the live flow.
- **Blast:** none; verification-only; a real-session run may surface a bug and require a small fix commit.

### Gap 4 — Runbook + PRD note documenting the widening gate

- **In scope because:** the owner's decision "interception widening (hook for ALL sessions) is the LAST gated step" (d-2026-08-09-001 + memory) is written only in the handoff and in `.claude/settings.json:100`'s `$comment`. Phase 7 documentation does not name the widening as an explicit post-feature-complete gate. This is a documentation-only gap that matters at the moment the owner starts real testing (the promised next step after feature-complete).
- **Evidence of gap:** `docs/prd/01-phase7-interactive-control-plane.md` does not mention "widening" or "GOSLEEP_WEB_QUESTIONS=1 for all sessions"; `docs/runbooks/gosleep-core.md` section 8 documents the pilot mechanism but does not state the widening gate explicitly.
- **Blast:** documentation only.

---

## 3. Proposed next epic

**Suggested epic summary (Jira):**
`[Web][Repo] Web control plane feature-complete: snapshot button + live proofs (owner dogfooding)`

**Rationale for calling it a fresh epic (not extending GSL-250):** GSL-250 is merged, verified 100, closed on the run-02 dossier. Reopening it invalidates the audit trail. A fresh epic keeps the closure clean and gives the owner a single Jira object to track "the last inch before I start really using the web".

**One branch per epic** convention: `<EPIC-KEY>-feature-complete`. Regular merge, one commit per task.

**Tasks (ordered by dependency):**

1. **`[Core][Web] POST /actions/snapshot + Overview snapshot button`**
   Add a low-blast write endpoint that spawns `apps/core/scripts/snapshot.sh` in a mutex-guarded region (per-endpoint `serialize`, `withTimeline` intents ledger, same envelope as the other `/actions/*` calls). Reuse the existing Bearer + Origin + Idempotency-Key layers. Add a "Snapshot" button to `apps/web/src/screens/Overview.tsx` next to the RunwayTile with a click → POST → success toast → refresh of the last-snapshot timestamp. Update `tools/lab/tests/core-smoke.sh` with a scenario. Acceptance: click in Safari/Chrome writes a new `data/snapshots/YYYY-MM-DD/` dir and returns 200 with the snapshot path in the response body.
   *Size:* S. *Depends on:* nothing. Enables the missing PRD end-check bullet.

2. **`[Core][Docs] Live proof: AskUserQuestion answer-loop end-to-end (owner ↔ real agent via guarded pilot)`**
   Start a real subordinate Claude Code session with `env GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_INTERNAL_SECRET=… claude …`, drive it to trigger a real `AskUserQuestion`, click one of the four button variants (pick / custom / defer / apply-manifest) in the web UI, capture the full transcript (network log, DB row, agent's next tool call). Record findings and screenshots to `docs/reports/verifications/GSL-<new>/runs/01/` per the owner's verification-report format. If a real bug surfaces, file a fix-task inside this same epic and re-run.
   *Size:* M. *Depends on:* nothing (can run in parallel with task 1). Feeds task 5.

3. **`[Core][Docs] Live proof: PermissionRequest hook end-to-end (owner allow/deny of a real tool-use)`**
   Same shape as task 2 but for the second PreToolUse matcher (`PermissionRequest`, GSL-284). Drive a session under the pilot flag to invoke a Bash / Write tool call, expect the shim to POST `/internal/permissions/post`, click Allow and Deny variants in the web UI, verify the agent proceeds/aborts correctly. Add smoke assertion in `core-smoke.sh` for the endpoint if not already covered. Record to `docs/reports/verifications/GSL-<new>/runs/01/`.
   *Size:* M. *Depends on:* nothing (parallel with tasks 1 and 2). Feeds task 5.

4. **`[Web][Docs] Fleet live-values proof: current_tool + context_pct populated in real session`**
   Under the same pilot flag as tasks 2-3, verify `Fleet.tsx` renders live `current_tool` and `context_pct` values on the running subordinate session (instead of the "unknown" fallback that run 02 finding 6 documented). Confirm the debounce (1 s server-side per addendum §8.1) works and no thrash occurs. This is not a new feature; it converts R7.4 from PARTIAL to DELIVERED with a live evidence line. Include screenshot in `docs/reports/verifications/GSL-<new>/runs/01/assets/`.
   *Size:* S. *Depends on:* task 2 (piggybacks on the same live-pilot session harness).

5. **`[Docs][Process] Feature-complete verification dossier + widening-gate note`**
   Assemble the three live-proof runs (tasks 2, 3, 4) plus the snapshot demonstration (task 1) into a single HTML dashboard (EN primary + RU shell) via the `agentic-report-creator` skill under `docs/reports/verifications/GSL-<new>/runs/01/index.html`. Score against each R7.x. Add one paragraph to `docs/prd/01-phase7-interactive-control-plane.md` under "Acceptance criteria + end-check" that (a) declares feature-complete on this dossier's landing and (b) names the widening step (`GOSLEEP_WEB_QUESTIONS=1` for all sessions) as the explicit post-feature-complete gate, executed only on owner command. Add one paragraph to `docs/runbooks/gosleep-core.md` section 8 pointing at the widening gate. NO code change to widen — that requires an explicit owner command (handoff 57 hard rule).
   *Size:* M. *Depends on:* tasks 1, 2, 3, 4.

**Size mix:** 2× S (tasks 1, 4) + 3× M (tasks 2, 3, 5) = five tasks total. All commit-sized; each can land in one commit under one PR.

**Estimated total effort:** 3-5 days for one worker at Opus 4.7, given tasks 2-3 dominate (live-session choreography and evidence capture); tasks 1 + 4 are single-session slices.

---

## 4. Explicit exclusions (owner decisions + this brief)

The following are DELIBERATELY NOT in the proposed epic, per source owner decisions cited:

- **TouchID / Keychain (wiring into a live write path)** — paused per `d-2026-08-09-001` until web is feature complete. The `.app` bundle at `apps/core/bin/touchid-gate.app` and `apps/core/src/security/keychain.ts` hardening (ACL + 5s timeout + Tahoe 26.x guard + audit line) stay as shipped; no verify item filed, no wiring proposed. The snapshot write (Gap 1) intentionally goes through the low-blast Bearer-only path, not TouchID.
- **Interception widening — the hook for ALL sessions** — deferred per `d-2026-08-09-001` until owner starts real testing after feature complete. Named in the proposed epic's task 6 documentation ONLY as a post-feature-complete gate, not as a task.
- **GSL-271 (final SoT switchover, chronicler stops regenerating static HTML)** — soak-gated 30-60 days from 2026-08-09.
- **GSL-174 (skills management system, including "Publish skill" button and TouchID e2e)** — postponed entirely per `d-2026-08-08-002`. Tickets GSL-266/286/287/288/292 remain re-parented to GSL-174; no work in this epic touches them.
- **Design direction / redesign** — approved as-is per shift 75 handoff section 2. No design tickets proposed. The one proposed UI addition (snapshot button) reuses shadcn components already in the codebase.
- **Project `.claude/settings.json` edits beyond the future widening command** — frozen per handoff 57 hard rules. The proposed epic does not modify the pilot hook stanza.
- **Channels v1.1 supervised proof (`--dangerously-load-development-channels`)** — although shift 75 named it as a backlog seed, rev-3 addendum Delta 2 scopes channels as v1.1 (post-feature-complete). `packages/gosleep-channel/` ships as scaffolding today; a live proof belongs to a future v1.1 epic, not to feature-complete.
- **SessionAdapter — second live implementation (OpenAI/Codex)** — non-goal per PRD "Non-goals" list; the `.md` sketch is the scope.
- **`/metrics` external scrape configuration** — non-goal per PRD "Non-goals"; `curl 127.0.0.1:7331/metrics` from the owner's machine is the sole design.
- **Deprecation banner on `docs/reports/web-harness-research-2026-08-03/index.html`** — Delta 11 landed (GSL-283); grep confirms `Superseded` banner + inline note present. No follow-up needed.

---

## 5. Open questions for the owner

None. Every remaining decision has a documented owner ruling or a self-evident acceptance criterion in the PRD:

- Widening is deferred → task 6 documents the gate, does not execute it.
- Skills-publish work is postponed → not included.
- TouchID is paused → snapshot chosen as low-blast; no TouchID needed.
- Design approved → no redesign proposal.
- Channels are v1.1 → excluded from feature complete.
- Snapshot button is a PRD end-check item → task 2, no fork.
- Live proofs (AskUserQuestion + PermissionRequest + Fleet) close acceptance items already in the PRD → no fork.

If the owner disagrees with any exclusion (particularly the Channels v1.1 supervised proof), they can promote it explicitly — that would flip it from "excluded" to a seventh task in the epic.

---

## 6. Contradictions / flags surfaced during analysis

1. **PRD Scope table (line 44) lists "Channels v1.1 plugin gosleep-as-channel" as "In" scope, but rev-3 addendum Delta 2 says channels are v1.1, i.e. NOT v1.** These are consistent (v1 ships the scaffolding; a supervised live proof is v1.1), but a first-time reader of the PRD alone might infer channels are part of v1 feature-complete. Task 6's PRD paragraph should clarify.
2. **PRD end-check names the snapshot button as a required step (see section 1 table above), yet no code was ever written for it.** Run 02's finding set (11 items) did not flag this — the audit lens was fix-confirmation of run 01's findings, not full end-check re-verification. This is not a run-02 miss; it is a gap that would only be caught by re-running the end-check itself against the shipped code. Recommend the run-02 dossier's "What was NOT re-verified" section be updated with this note when the feature-complete epic closes.
3. **R7.4 sub-fields (`current_tool`, `context_pct`) live in the shipped schema/UI but are gated on the pilot session running with `GOSLEEP_WEB_QUESTIONS=1`.** Run 02 finding 6 records them as honest "unknown" pills; live population has never been demonstrated in a doc-of-record. Marked PARTIAL, task 5 closes it.
4. **Jira JQL sweep did not return GSL-272 / GSL-273 among the open-issues list.** Handoff 57 says they were `To Do` at shift close. Possible causes: they were transitioned after the handoff was written, or the JQL scoping missed them (query was `statusCategory != Done`, so anything at To Do or In Progress should appear). Task 1's first step is a targeted `mcp__atlassian__getJiraIssue` on each key to confirm actual state.

---

## 7. Anchors used

- **Merge base:** `main` @ `56f57d1` (Merge PR #295, GSL-250 control plane).
- **PRD:** `docs/prd/01-phase7-interactive-control-plane.md` (post-rescope 2026-08-08).
- **Architecture:** `docs/reports/web-harness-research-2026-08-03/target-architecture.md` rev 2 + `target-architecture-rev3-addendum.md`.
- **Verification baseline:** `docs/reports/verifications/GSL-250/runs/02/payload.json` (score 100, all fixes hold).
- **Handoff:** `docs/handoff/57-2026-08-09-handoff-shift75-final.md`.
- **Owner decisions:** `d-2026-08-03-004` (Warren-model), `d-2026-08-03-007` (R1..R7 restatement), `d-2026-08-08-001` (guarded pilot), `d-2026-08-08-002` (Phase 7 re-scope), `d-2026-08-09-001` (design + TouchID pause + widening deferred).
- **Standing rules:** no silent-default decisions; no `git stash` / `git reset` in shared tree; auto-merge green PRs; English artifacts; workers on Opus 4.7 by default; project `.claude/settings.json` frozen.

## End of analysis.
