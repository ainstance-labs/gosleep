# Execution plan — Epic GSL-174, Skills Management System

**Author:** plan-174 (read-only night planning worker, night-autonomy session per `d-2026-08-09-005`).
**Date:** 2026-08-10. **Status:** PROPOSAL for orchestrator review — no tickets filed, no code written, no commits landed by this worker.
**Owner:** Roman L (`rommxx@gmail.com`). **Project:** GSL. **Epic:** [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174).
**Design source of truth:** `docs/plans/skills-governance-plan.md` (Russian, owner-approved 2026-08-03, `d-2026-08-03-003`) + `docs/reports/web-harness-research-2026-08-03/target-architecture.md` §7 + `-rev3-addendum.md` Delta 4.

Terminology note (owner rule): the full name is «система управления скилами» / *skills management system* — never the shorthand "skills". The whole plan is written to keep both the meaning ("who edits what, who publishes, with what evidence") and the safety inversion in view.

---

## 1. Current state (measured 2026-08-10)

### 1.1 Skill directory inventory

| Skill | `skill/<name>/` in repo | `~/.claude/skills/<name>/` | Drift (`diff -r`) | Notes |
|---|---|---|---|---|
| orchestrating-delivery-agents | present | present | **50 lines** | Governance plan measured 21/12 on 2026-08-03; global has drifted further. GLOBAL is authoritative (owner `2026-07-20`). |
| using-jira | present | present | **24 lines** | Governance plan measured 16/0; the ATLASSIAN_API_TOKEN lesson still lives only in global. |
| delivery-workflow | present | present | 0 | Identical. |
| handoff | present | present | 0 | Identical. |
| writing-prds | present | present | 0 | Identical. |
| remote-control | present | present | 0 | Added since the governance plan. Governance plan doc names "seven skills" — the true count is now seven only if we count `tmux-agents-orchestration`; local git shows **six** owned skill dirs today. |
| tmux-agents-orchestration | **absent from git** | present (14 KB) | n/a | Single copy, no backup. Owner-sanctioned reverse-sync is stage 1 of the plan. |

Total tracked in `install.sh`'s `for skill_dir in "${SKILLS_SRC}"/*/`: 6. Total in production: 7. Delta between the governance plan's "5-then-6" list and today: `remote-control` was added since (governance plan enumerates orchestrating-delivery-agents / delivery-workflow / handoff / using-jira / writing-prds / tmux-agents-orchestration).

### 1.2 Guard state and safety anchors

* `install.sh`: the file opens with a stderr banner and `exit 1` **before** the first `rsync` — introduced 2026-07-20. Verified verbatim; the four-layer defense from governance plan §2 has this guard permanently ON. This is the **only** of the four layers that works today; the other three (rule in `CLAUDE.md`, owner-check in `publish.sh`, production test-guard) do not yet exist.
* `CLAUDE.md` "Safety rules": already forbids `./install.sh` for agents; explicitly forbids syncing `orchestrating-delivery-agents` without owner say-so; allows pointwise `rsync -a skill/<name>/ ~/.claude/skills/<name>/` for other skills. This is a hard rule for every agent, including this planner.
* Owner memory `orchestrator-delegate-to-subagents.md` and `gosleep-owns-all-delivery-skills.md`: reinforce "GLOBAL copies authoritative, install.sh disabled, reverse-sync only on explicit owner command".

### 1.3 Jira backlog under epic GSL-174 (21 children, all `To Do`)

Two streams as declared in the epic description (2026-08-03) + the five re-parented verifier tickets from Phase 7 re-scope (`d-2026-08-08-002`, 2026-08-08).

**Stream 1 — content edits to the existing skills (9 tickets):**

| Key | Status | Target file | Buildable tonight? |
|---|---|---|---|
| GSL-182 | To Do | `~/.claude/skills/orchestrating-delivery-agents/SKILL.md` (roll trigger) | **NO** — global authoritative, waits on stage-1 reverse-sync |
| GSL-183 | To Do | `orchestrating-delivery-agents` (Workflow-tool gate) | **NO** — same |
| GSL-184 | To Do | `orchestrating-delivery-agents` (spawn mechanics) | **NO** — same |
| GSL-185 | To Do | `orchestrating-delivery-agents` (git stash ban) | **NO** — same |
| GSL-186 | To Do | `handoff` + `delivery-workflow` + `CLAUDE.md` (handoff path + wiki + dev_history filename) | **YES** — zero-diff skills |
| GSL-187 | To Do | `orchestrating-delivery-agents` (model policy split into project manifest) | **NO** — same |
| GSL-188 | To Do | `orchestrating-delivery-agents` (telemetry contradiction) | **NO** — same |
| GSL-189 | To Do | `CLAUDE.md` + skill (shift-checklist rule) | **YES** — CLAUDE.md primary |
| GSL-190 | To Do | Reverse-sync `tmux-agents-orchestration` + reconcile lists in `CLAUDE.md` + `skill/README.md` | **NO** — folds into stage-1 owner sanction |

**Stream 2 — the working system (7 stages, tickets GSL-251…GSL-257):**

| Key | Status | Stage | Buildable tonight? |
|---|---|---|---|
| GSL-251 | To Do | Stage 1 — one-off reverse-sync `~/.claude/skills/` → `skill/` for ALL skills | **NO** — explicit owner action per inversion rule (`d-2026-07-20`) |
| GSL-252 | To Do | Stage 2 — `docs/skills/CHANGELOG.jsonl` + JSON schema + validator | **YES** |
| GSL-253 | To Do | Stage 3 — `tools/skills/publish.sh` CLI (diff, confirmation, backup, single-skill rsync, registry row) | **PARTIAL** — TTY-confirm interim only; TouchID leg PAUSED per `d-2026-08-09-001` |
| GSL-254 | To Do | Stage 4 — `verify-local.sh` pre-publish sanity check + production test-guard baseline in `tools/lab/smoke.sh` | **YES** |
| GSL-255 | To Do | Stage 5 — Skills page in `apps/web` (React) — status, history, diff, "Publish" button | **YES (read-only view + disabled CTA)** — the button surface can ship tonight, disabled with an honest tooltip; the actual publish click waits on TouchID |
| GSL-256 | To Do | Stage 6 — abstract the question-queue helper contract in the skill (drop coupling to `tools/lab/lab-emit.sh`) | **NO** — touches `orchestrating-delivery-agents` |
| GSL-257 | To Do | Stage 7 — acceptance on a live lesson (full path development → registry → panel → publish by owner) | **NO** — owner presence + TouchID |

**Re-parented verifier tickets (5, from Phase 7 rescope):**

| Key | Status | What it names as the defect | Overlap with stream 2 |
|---|---|---|---|
| GSL-266 | To Do | Web write button end-to-end: `POST /actions/skills/publish` + Skills screen + TouchID e2e (target-architecture step 7) | Overlaps GSL-253/255 + adds the missing web wiring |
| GSL-286 | To Do | CRITICAL — `POST /actions/skills/publish` endpoint absent in shipped server (grep-verified: 8 POST routes registered, `skills/publish` not among them) | Sub-scope of GSL-266 |
| GSL-287 | To Do | CRITICAL — no Skills screen in the web UI (6 of 7 promised screens; `/skills` falls to `NotFoundScreen`, GSL-295) | Sub-scope of GSL-255 |
| GSL-288 | To Do | CRITICAL — TouchID `.app` bundle present but never invoked from core; physical barrier absent at runtime | Sub-scope of GSL-266; **BLOCKED** by TouchID pause |
| GSL-292 | To Do | MAJOR — `/skills` endpoint returns `{"skills":[],"count":0}`; skills registry has no writer | Sub-scope of GSL-253 (publish.sh writes rows via `apps/core/scripts/record-publish.ts`) |

### 1.4 Web control plane surface (as it stands after GSL-297 merge + GSL-304 fix)

Confirmed by `grep`/reads on 2026-08-10:

* `apps/core/src/routes/actions.ts` registers 9 POST endpoints (`/actions/questions/answer|resolve|apply-manifest|defer`, `/actions/tasks/sync`, `/actions/tick`, `/actions/permissions/decide`, `/actions/snapshot`, `/actions/events/ack`). No `/actions/skills/*`.
* `apps/core/src/routes/read.ts` line 227: `GET /skills` (Bearer-gated) exists and reads the `skills` table — but the table is empty because no writer exists.
* `apps/core/src/db/schema.ts` line 143: `skills` table defined (name, version, status, last_published_at, last_published_by, changelog).
* `apps/core/src/actions/spawn.ts`: generic `spawnAwait` helper exists — right shape for a `spawn/publish.ts` module that shells out to `tools/skills/publish.sh` with a fresh env-secret and threads through `withTimeline`.
* `apps/web/src/router.tsx`: six route children (`overview`, `fleet`, `timeline`, `questions`, `tasks`, `cost`); wildcard `*` → `NotFoundScreen` (GSL-295); no `skills` child.
* `apps/web/src/components/AppShell.tsx`: NAV array has the same six entries.
* `apps/core/bin/touchid-gate.app/`: signed `.app` bundle exists (Delta 4 shape); no code path invokes it.
* `apps/core/bin/tty-confirm.sh`: sibling script exists — this is the fallback lever the plan uses tonight while TouchID is paused.
* Write-envelope pattern is uniform across shipped endpoints: `requireBearer` middleware → `serialize(endpoint, ...)` per-endpoint mutex → `withTimeline(...)` idempotency + ledger. `apps/core/src/actions/spawn.ts` returns `{ok, code, stdout, stderr, timedOut, elapsedMs}` and auto-forwards `PATH`, `HOME`, `GOSLEEP_LAB_DIR`, `GOSLEEP_RUN_ID`. Any new publish spawn plugs into this stack unchanged.

### 1.5 Owner constraints in force

* `d-2026-07-20` — GLOBAL copies of skills are authoritative; `install.sh` guard on; reverse-sync only on explicit owner command; `orchestrating-delivery-agents` **never** auto-synced.
* `d-2026-08-03-003` — governance plan §7 (7 stages) approved by the owner.
* `d-2026-08-08-002` — Phase 7 rescope; F7-S3 items move to GSL-174; verifier tickets GSL-266/286/287/288/292 re-parent to GSL-174.
* `d-2026-08-09-001` — TouchID + Keychain **PAUSED** until an owner-testing phase; the gate cannot be built into a live write path tonight.
* `d-2026-08-09-002` — GSL-174 is the designated next focus after web feature-complete.
* `d-2026-08-09-005` — night-autonomy session; take professional defaults, collect questions for morning digest.
* Memory `no-silent-default-decisions.md` — no auto-timers on decisions; but the same memory is compatible with morning-digest questions (owner-approved 2026-08-08 for autonomous sessions).

---

## 2. Scope synthesis

**One-sentence framing.** The Skills Management System is a four-layer safety envelope around a single owner gesture ("Publish this skill"), backed by a git-tracked development copy, an append-only registry, a per-skill CLI that refuses to run without a physical owner signal, a web page that shows the diff and history, and an acceptance walkthrough on a real lesson — all built without ever handing an agent the ability to mutate `~/.claude/skills/` directly.

**Authority-inversion constraint (non-negotiable).** Until stage 1 (GSL-251) lands with the owner's sanction, the authoritative source of truth for `orchestrating-delivery-agents` and `using-jira` is `~/.claude/skills/<name>/`. Any content edit against those two skills done in `skill/<name>/` before stage 1 will either be lost or produce merge conflicts against the reverse-sync. Any tooling that touches `~/.claude/skills/` (rsync, delete, chmod) is forbidden to agents by rule and must never appear in a code path an agent can drive; the four-layer defense — CLAUDE.md prose rule, `publish.sh` owner check, production test-guard, `install.sh` guard — is the only sanctioned shape for that access.

**TouchID pause implication.** Governance-plan stage 3 (publish.sh) and target-architecture rev-3 addendum Delta 4 both build the owner-gesture layer as TouchID via the signed `.app` bundle. With TouchID paused (`d-2026-08-09-001`), tonight's plan builds the same code path but wires **only** the TTY-confirm fallback (`bin/tty-confirm.sh`) — the interim gate the governance plan already contemplates for "MacBook без сенсора". This keeps the security semantics honest (an agent under the owner's UID with no TTY still fails the check) while unblocking the rest of the vertical. The TouchID leg lands the moment `d-2026-08-09-001` lifts; the endpoint contract and the spawner shape are the same, one function call away.

**Where the two streams meet.** Governance plan §7 explicitly joins stages 4-5 with epic GSL-250: the Skills page becomes the first write area of the control plane. With GSL-250 now feature-complete, the same joining principle plus GSL-266/286/287/288/292 collapse to a coherent sub-epic: **build the whole publish vertical end-to-end (endpoint + spawner + screen + registry writer + read-diff endpoint), with the physical-gesture layer stubbed to TTY-confirm until TouchID lifts, and accept it on a live lesson**.

**Explicit out-of-scope (do not plan tonight).**

* Bulk `install.sh` sync (excluded by construction; guard stays on forever; `--all` does not exist in `publish.sh`).
* Automatic publish without an owner gesture (excluded; `publish.sh` gates on TouchID OR TTY-confirm; agent in a pipe fails both).
* Any mutation of `~/.claude/skills/` from anywhere outside `publish.sh` (excluded; production test-guard would catch it).
* Bidirectional Jira sync of skill lessons.
* Cross-project skill promotion (a skill from gsd-* or a plugin into this repo, or vice versa).
* Editing the global copy of `orchestrating-delivery-agents` tonight (per `d-2026-07-20`, only explicit owner-driven edits — the recent 4 owner-edits on 2026-08-02 followed this pattern).

---

## 3. Proposed PRD phase file

**Filename convention** (from `~/.claude/CLAUDE.md` owner rule and the existing repo layout):

* Current PRDs in `docs/prd/`: `PRD-gosleep-evolution.md` (monolith, phases 1-6 archive), `01-phase7-interactive-control-plane.md`.
* Next NN = `02`. Next phase MM = `8` (Skills Management is phase 8 in evolution order — Phase 7 was the interactive control plane).
* **Proposed file:** `docs/prd/02-phase8-skills-management.md`.
* Language: **English** (owner rule 2026-08-07, per `~/.claude/CLAUDE.md`).

**Section skeleton (proposed):**

1. **Metadata block** — status/owner/project/epic (GSL-174)/design source of truth (`docs/plans/skills-governance-plan.md` §7 + `target-architecture.md` §7 + `-rev3-addendum.md` Delta 4)/parent PRD (`PRD-gosleep-evolution.md`)/language rule pointer.
2. **Positioning: Phase 8 is the working system for the skills mandate** — the "lesson → skill edit" loop worked 30 days and stopped on 2026-07-10; Phase 8 restores it with the safety envelope the owner agreed to on 2026-08-03; the four-layer defense is the invariant.
3. **Goal** — one paragraph: "the owner can publish a skill from `~/.claude/skills/<name>/` end-to-end without ever handing an agent the ability to mutate production".
4. **Scope table (In / Out)** — mirroring Phase 7 format. Explicit In: registry + CLI + verify-local + test-guard + web screen + read-diff endpoint + POST endpoint + writer script + acceptance on a live lesson. Explicit Out: bulk sync, automatic publish, cross-project promotion, bidirectional Jira sync, edits to the authoritative global copies outside the sanctioned path.
5. **Success criteria (F8-S1…F8-S7)** — one per stage, phrased as a demonstrable outcome:
   * F8-S1 (registry): `docs/skills/CHANGELOG.jsonl` exists, schema validates the file, `tools/lab/smoke.sh` fails on a corrupt row.
   * F8-S2 (publish.sh): CLI refuses in pipe context (no TTY, no owner env-secret), succeeds under owner TTY, backups + rsync + row + timeline event all present.
   * F8-S3 (verify-local + test-guard): pre-publish sanity check catches a broken references file; production test-guard fails when a file in `~/.claude/skills/` mutates without a matching CHANGELOG row.
   * F8-S4 (web wiring): `POST /actions/skills/publish` visible in the eight-endpoint grep + returns 200 with an `intent_id`; SSE broadcasts `skills.publish.*` events; Idempotency-Key double-click protection matches Phase 7 pattern.
   * F8-S5 (Skills screen): opening `http://127.0.0.1:7331/skills` shows seven rows with status computed from filesystem hashes + registry state; button is enabled only when there are unpublished changes.
   * F8-S6 (writer + reader): `apps/core/scripts/record-publish.ts` populates the `skills` table on publish; `GET /skills` returns the populated rows; page updates in real time via SSE.
   * F8-S7 (acceptance): a real lesson walks the full path (development commit → CHANGELOG draft row → panel diff → owner clicks → TouchID/TTY prompt → snapshot + rsync + CHANGELOG published row → chronicler re-render) with a verification HTML report under `docs/reports/verifications/GSL-174/runs/01/` per `memory/verification-report-runs-format.md`.
6. **Constraints (cross-phase)** — TouchID pause (interim TTY-confirm), authority-inversion (stage 1 first for `orchestrating-delivery-agents` and `using-jira`), the four-layer defense stays intact through every ticket, no `--all` anywhere, no bulk operations.
7. **Task decomposition** — map to Jira keys (§4 of this plan document).
8. **Dependencies** — stage 1 blocks stream-1 content edits for two skills + GSL-256; TouchID lift blocks GSL-266/288 full completion; everything else is unblocked.
9. **Non-goals** — copy from §2 of this plan.
10. **Risks + open questions** — copy from §5 of this plan.
11. **Sources** — verbatim pointers to `docs/plans/skills-governance-plan.md`, target-architecture rev 2 + rev-3 addendum, all epic-linked decisions in `docs/lab/decisions/log.jsonl`.

Length target: ~250-350 lines (Phase 7 PRD is ~500 with tables; Phase 8's scope is tighter, mostly re-uses Phase 7 primitives).

---

## 4. Proposed epic execution order

Convention (per `~/.claude/CLAUDE.md` + skill `delivery-workflow`): one branch per epic (`GSL-174-skills-management`), one commit per Task (message begins with `GSL-N …`), one PR per Epic, regular merge (no squash), dev-history file per Task under `docs/dev_history/GSL-N-phase8-<slug>.md`, task summaries begin with 1-3 `[Tag]` markers.

The order below **re-uses existing Jira keys** where they exist (columns "Existing Jira") and proposes **new task keys** (columns "Proposed") where the plan splits or adds work the current backlog does not name. The orchestrator files new keys during the create-issues step.

### 4.1 Buildable tonight (autonomously)

| # | [Tag] Summary (2-4 sentence scope) | Size | Existing Jira | Depends on | Notes |
|---|---|---|---|---|---|
| T1 | **[Docs][Skill] Skills changelog registry — file + JSON schema + validator.** Create `docs/skills/CHANGELOG.jsonl` (empty), `tools/skills/schema/changelog.schema.json` (per governance plan §6: `ts` ISO-8601, `skill` from enum of 6-7 names, `task` `^GSL-\d+$`, `commit` full SHA, `lesson` free text, `status` `draft`/`reviewed`/`published`), `tools/skills/validate-changelog.sh` (walks JSONL, fails on invalid rows), wire into `tools/lab/smoke.sh`. | S | GSL-252 | — | Owner env-secret name (`GOSLEEP_WEB_TOKEN`) reserved for later stages. |
| T2 | **[Tooling][Skill] `tools/skills/verify-local.sh <name>`.** Pre-publish sanity check: SKILL.md exists + non-empty, referenced files under `references/` are readable, filename convention (`SKILL.md` + `references/*.md`), `git status --porcelain skill/<name>/` clean. Exit 0 on pass, non-zero + diagnostic on fail. | S | GSL-254 (partial) | T1 | Called by publish.sh (T3) before rsync. |
| T3 | **[Tooling][Skill] `tools/skills/publish.sh <name>` — TTY-confirm interim (no TouchID).** Accepts exactly one skill name (refuse `--all` + zero-arg + multi-arg). Shows `diff -r skill/<name>/ ~/.claude/skills/<name>/`. Owner gate: `isatty(0)==true` OR `$GOSLEEP_WEB_TOKEN` matches the env-secret the endpoint spawns with (T5). No TTY + no env-secret → refuse code 1. On confirmation: call `verify-local.sh` (T2), backup production to `docs/skills/backups/<name>-<UTC-ts>/` via `cp -a`, `rsync -a --delete skill/<name>/ ~/.claude/skills/<name>/`, append `status: published` row to CHANGELOG.jsonl via `record-publish.ts` (T4). TouchID leg is a single-line `TODO: wire touchid-gate.app when d-2026-08-09-001 lifts` next to the TTY branch; no code call. | M | GSL-253 (partial) | T1, T2 | This is the interim shape; the TouchID call is one function invocation away. |
| T4 | **[Web][Skill] `apps/core/scripts/record-publish.ts` — skills-table writer.** Reads `docs/skills/CHANGELOG.jsonl`, computes per-skill state (`last_published_at`, `last_published_by`, `version` = trailing SHA-4, `status` = `published`/`draft`/`clean`), upserts into the `skills` table. Invoked as the last step of `publish.sh` (T3) and once at boot as a full re-fold (idempotent). Populates the empty `/skills` endpoint that GSL-292 flagged. | S | GSL-292 | T1 | Fold pattern mirrors `apps/core/src/indexer/` tail-fold idempotency. |
| T5 | **[Web] `POST /actions/skills/publish` endpoint + spawner.** Add `apps/core/src/actions/publish.ts` (new module) that follows the three-layer envelope (`requireBearer` → `serialize("skills.publish", ...)` → `withTimeline("skills.publish", {name}, ...)`). Spawner shells out to `bash tools/skills/publish.sh <name>` with `env GOSLEEP_WEB_TOKEN=<per-request nonce>` and a `timeoutMs: 60_000`. Emits `skills.publish.started`, `skills.publish.confirmed`, `skills.publish.snapshotted`, `skills.publish.published` (or `.denied`, `.timedout`) via the SSE broadcaster. Response `{intent_id, status}`. Interim safeguard: since TTY is not available on the web-spawned process, the spawn always relies on the `GOSLEEP_WEB_TOKEN` gate — an agent under the owner's UID **cannot** call this endpoint without knowing the per-request nonce that only the web server generates. Register the route in `apps/core/src/routes/actions.ts`; add schema in `packages/schema/`. | M | GSL-286 (+ overlaps GSL-266) | T3, T4 | Uses existing `spawnAwait` + mutex + timeline; no new infra. |
| T6 | **[Web][Skill] `GET /skills/:name/diff` — read-only diff endpoint.** Returns `{name, hasChanges, diffText, hashLocal, hashProd, changelog: [...]}` computed by `diff -u skill/<name>/ ~/.claude/skills/<name>/` (bounded to 200 KB per call) + SHA-256 over `find … -type f` sorted. Bearer-gated; per-name serialisation to avoid concurrent read spikes. Enrich `GET /skills` to include `status: 'clean' | 'has-changes'` from the same computation. | S | GSL-255 (partial) | T4 | Diff computation cached with a 5-second TTL under `apps/core/src/skills/diff.ts`. |
| T7 | **[Web][Skill] Skills screen in `apps/web`.** New `apps/web/src/screens/Skills.tsx` + route child `{ path: "skills", element: <SkillsScreen /> }` in `router.tsx` + NAV entry `{ to: "/skills", label: "Skills", icon: BookText }` in `AppShell.tsx`. Rows show name, status badge (`Clean` / `Has changes N files`), `last_published_at`, `last_published_by`. Click on a row opens a details drawer with diff (from T6) + CHANGELOG history rows (linked to Jira/GitHub). "Publish" button visible on rows with changes; **disabled with tooltip** `TouchID paused — publish via CLI: bash tools/skills/publish.sh <name>` (per `d-2026-08-09-001`). SSE subscription to `skills.publish.*` events for real-time status flip. TanStack Query keys under `apps/web/src/data/queries.ts`. Removes the `/skills → NotFoundScreen` gap flagged by GSL-287. | M | GSL-255 + GSL-287 | T4, T5, T6 | Button enable is one boolean flip when TouchID lifts. |
| T8 | **[Skill] GSL-186 — handoff path + wiki + dev_history filename.** Update `skill/handoff/SKILL.md` (single file path), `skill/delivery-workflow/SKILL.md` (remove `docs/wiki/`), `CLAUDE.md` and `skill/handoff/SKILL.md` reconcile dev_history filename format with `docs/dev_history/README.md` convention. Local-only edit (both target skills are zero-diff — no reverse-sync needed). Pointwise `rsync -a skill/handoff/ ~/.claude/skills/handoff/` + `skill/delivery-workflow/` after commit; publish via T3 CLI is the intended path but a pointwise rsync is allowed per CLAUDE.md while T3 is not yet on `main`. | S | GSL-186 | T1 (for CHANGELOG row) | Zero-diff skills → safe. |
| T9 | **[Docs][Process] GSL-189 — shift-checklist rule for skill edits.** Add the rule to `CLAUDE.md` "Skill source of truth" and to `skill/handoff/SKILL.md` shift-closing checklist: "editing an authoritative skill copy is a mandatory shift-closing item, on par with the handoff". Root-cause treatment for the learning-loop stall. | S | GSL-189 | — | CLAUDE.md primary; handoff skill is zero-diff so pointwise rsync applies. |
| T10 | **[Tooling][Skill] Production test-guard in `tools/lab/smoke.sh`.** Capture baseline `find ~/.claude/skills -type f -exec sha256sum {} \;` at the start of `smoke.sh` (only when `GOSLEEP_SKILLS_GUARD=1` is set — opt-in until stage 1 done, then always on). At end of `smoke.sh`, recompute; if any hash changed AND no matching CHANGELOG row appeared (published in the same run), fail with code 1 + a diagnostic listing the changed files. Fourth-layer defense per governance plan §2. | S | GSL-254 (rest) | T1 | Opt-in gate keeps this from spuriously failing before the full path lands. |

**Rough tonight-vs-owner split for the buildable set:** 10 tasks (T1-T10), estimated 6-9 hours of worker time if executed in dependency order. Six tasks (T1, T2, T4, T6, T8, T9) are S; four (T3, T5, T7, T10) are M; none L.

### 4.2 Needs owner (do not build tonight)

| # | [Tag] Summary | Size | Existing Jira | Blocker |
|---|---|---|---|---|
| O1 | **[Skill][Process] GSL-251 — one-off reverse-sync `~/.claude/skills/` → `skill/` for ALL skills.** Per-skill commit stating what was caught up (deltas: `orchestrating-delivery-agents` 50 lines, `using-jira` 24 lines, `tmux-agents-orchestration` full-file); acceptance: `diff -r` empty for every skill after; `install.sh` guard stays on. Folds GSL-190 (tmux reverse-sync + list reconciliation) into the same commit set. | M | GSL-251 + GSL-190 | Explicit owner sanction (inversion rule `d-2026-07-20`). Agent runs `rsync -a ~/.claude/skills/<name>/ skill/<name>/` per skill only after owner confirms in chat. |
| O2 | **[Skill] GSL-182 — roll trigger (real harness signal, not context self-estimate).** Content edit to `skill/orchestrating-delivery-agents/SKILL.md`. | S | GSL-182 | O1 (skill drift = 50 lines; edit before reverse-sync would collide or be lost) |
| O3 | **[Skill] GSL-183 — "ask owner" gate before Workflow tool invocation.** Insert five-word gate paragraph in the skill. | S | GSL-183 | O1 |
| O4 | **[Skill] GSL-184 — agent spawn mechanics for the current harness.** Replace TeamCreate references with the correct Agent + isolation shape; correct `run_in_background`/`team_name` claims. | S | GSL-184 | O1 |
| O5 | **[Skill] GSL-185 — ban `git stash` in a shared working tree.** Single-line addition next to the force-push ban. | S | GSL-185 | O1 |
| O6 | **[Skill] GSL-187 — model policy: principle in skill, specific models in project manifest.** Split gets rid of the three-source contradiction. | S | GSL-187 | O1 |
| O7 | **[Skill] GSL-188 — remove telemetry contradiction; describe the working method.** Locate transcript by codeword, sum `usage` deduped by message id, fail with `tokens=UNRECOVERED` rather than fabricating. | S | GSL-188 | O1 |
| O8 | **[Skill] GSL-256 — abstract the question-queue helper contract.** Move gosleep-specific `lab-emit.sh` mention into `skill/<name>/references/gosleep-adapter.md`; leave a role contract in the main text. | M | GSL-256 | O1 (touches `orchestrating-delivery-agents`) |
| O9 | **[Web][Security] GSL-288 — wire `touchid-gate.app` into `apps/core/src/actions/publish.ts`.** Replace the TTY-only branch from T3/T5 with `open -W -a apps/core/bin/touchid-gate.app` and read exit codes 0/1/2 (2 → TTY fallback per rev-3 addendum Delta 4). | S | GSL-288 | Owner lifts `d-2026-08-09-001` TouchID pause |
| O10 | **[Web] GSL-266 — enable the Skills-screen "Publish" button; e2e test.** Flip the disabled flag in `Skills.tsx`; add an e2e test with a TouchID mock (or real gesture on owner's machine) that walks click → dialog → TouchID → snapshot → rsync → CHANGELOG. | M | GSL-266 | O9 |
| O11 | **[Process][Skill] GSL-257 — acceptance on a live lesson.** Take one accumulated lesson (candidate: the roll-trigger update from GSL-182 once O2 has landed), walk it through the full path development → registry → panel → owner-clicks Publish → TouchID → snapshot → rsync → CHANGELOG published row → chronicler re-render. Produce the verification report under `docs/reports/verifications/GSL-174/runs/01/` per `memory/verification-report-runs-format.md` (HTML dashboard, EN + RU shells). | M | GSL-257 | O1, O10, and every task above closed |

### 4.3 Suggested execution order (dependency-respecting)

```
Tonight (autonomous):        T1 → T2 → T4 → T3 → T6 → T5 → T7 → T10 || T8, T9 in parallel
Then owner "yes" on stage 1: O1 (reverse-sync)
Then unblocked stream-1:     O2, O3, O4, O5, O6, O7, O8 (six S + one M, ~1 day of worker time)
Then TouchID pause lifts:    O9 → O10 → O11 (acceptance)
```

Total: **10 buildable-tonight tasks + 11 owner-gated tasks = 21 tasks**, one-for-one alignment with the current 21-child backlog once stage-1 folds GSL-190 into GSL-251. If the orchestrator prefers to file fewer, higher-level tickets, T1 + T2 + T4 collapse to a single "registry + writer + validator" ticket; T5 + T6 collapse to "web publish endpoint + diff read"; the split above is optimised for one-commit-per-task history and dev-history granularity.

---

## 5. Risks + open questions (for the morning digest)

Each item has a **recommended default** — the professional call this planner would take if pressed to decide silently, filed here per `d-2026-08-09-005` for the owner to confirm or override.

### 5.1 Risks (technical / operational)

1. **Skill-drift already exceeds the governance-plan snapshot.** `orchestrating-delivery-agents` is now 50 lines drifted (vs 21/12 measured on 2026-08-03) — the drift keeps growing because the owner keeps editing the global copy directly (4 point edits on 2026-08-02 per `d-2026-08-02-004`). Every day without stage-1 reverse-sync makes the "catch-up" commit noisier. **Recommendation:** file O1 first thing in the morning, execute the same day.
2. **The interim TTY-confirm gate is a security regression window.** Any agent running under the owner's UID **in an interactive shell** can now trigger `publish.sh` without a biometric gesture (they type `y`). The T5 endpoint mitigates the web path with a per-request nonce; the CLI path is only mitigated by "agents don't have a TTY". Under `d-2026-08-09-005` night autonomy, this is a tolerable interim; under owner-testing it must be replaced by TouchID immediately. **Recommendation:** track this as a known gap in the T3 dev-history file and re-confirm the mitigation with the owner before stage 7 acceptance.
3. **Production test-guard has a race with in-flight publish.** If T10's baseline snapshot is taken before T3's publish and the recompute happens after, the guard will see legitimate changes as violations. **Recommendation:** the "matching CHANGELOG row" check has to key on `intent_id` + timestamp, not on "any published row in this run"; make that check strict in T10.
4. **Diff endpoint on `orchestrating-delivery-agents` will be large (up to 50 lines diff × N files).** The T6 200 KB bound is generous; on a bigger drift a compressed representation may be needed. **Recommendation:** ship the 200 KB bound, add pagination in a v1.1 ticket if the diff ever exceeds it.
5. **The Skills screen's "seven skills" list vs the six in `skill/`.** Until O1 lands, `tmux-agents-orchestration` is production-only; the Skills screen must not hide it. **Recommendation:** the row is shown as `no development copy — publish blocked`, actionable label "reverse-sync required (GSL-251)".
6. **`d-2026-08-08-002` re-parented five verifier tickets but did not delete the corresponding sub-scope in GSL-266.** GSL-266 still names "Skills screen + POST endpoint + TouchID e2e" while GSL-286/287/288 name the same three. This is not a defect — it is the umbrella pattern — but the orchestrator should decide whether to close GSL-286/287/288 as duplicates once the umbrella work lands, or keep them as sub-verifications. **Recommendation:** treat GSL-266 as the umbrella deliverable, close 286/287/288 with a comment pointing at the closing commits.
7. **The governance plan is in Russian; the owner language rule is English (2026-08-07).** The plan pre-dates the rule. **Recommendation:** the Phase 8 PRD (§3 above) is the English artifact; the governance plan stays as a Russian historical source with a header pointer to the PRD.

### 5.2 Open questions (for morning digest)

Q1. **TouchID pause lift timeline?** The plan can ship 10 of 21 tasks under the pause. The acceptance ticket (O11) requires the physical gesture. If the owner-testing phase is >2 weeks out, we should ship the interim vertical (T1-T7, T10) with a Phase-8 PRD sub-goal explicitly labelled "TTY interim" and re-confirm acceptance is deferred. **Recommended default:** ship the interim vertical this week; delay acceptance (O11) until TouchID lifts. Ok to proceed?

Q2. **`--dangerously-skip-permissions` interaction.** Sessions launched with this flag bypass `PreToolUse` matchers. Does `publish.sh` need an extra defense against a `--dangerously-skip-permissions` session spawning it directly? The current design (env-secret nonce for the web path, TTY isatty for the CLI path) already covers both practical paths, but this is worth naming. **Recommended default:** add a one-line explicit check in `publish.sh` — refuse if `$CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` is set — belt-and-braces.

Q3. **Registry format: JSONL vs SQLite table only?** Governance plan §6 specifies `docs/skills/CHANGELOG.jsonl` as the source of truth. Rev-2 target architecture §4.3 puts `skills` table in SQLite as the source of truth. The two co-exist if the JSONL is the append-only ledger and the table is the projection (mirrors the events/queue.jsonl → SQLite pattern in Phase 7). **Recommended default:** JSONL is authoritative (git-tracked, human-readable); `skills` table is a projection populated by `record-publish.ts` (T4). This matches Phase 7's split.

Q4. **New skill added since the governance plan (`remote-control`).** The plan doc lists six skills for the "development copies" catch-up; today the count is seven (six repo + one production-only `tmux-agents-orchestration`; `remote-control` sits in both). Do we extend O1 to seven skills explicitly? **Recommended default:** yes — extend O1 to enumerate all seven; add `remote-control` explicitly to the catch-up commit (currently zero-diff, so it is a no-op commit for history bookkeeping).

Q5. **Publish button UX under the TTY-interim.** The T7 tooltip suggests running `bash tools/skills/publish.sh <name>` from a terminal. Should the panel instead **launch a terminal** on click (via `open -a Terminal.app` with an AppleScript that runs the command)? That would make the "web click" story more honest for the interim. **Recommended default:** ship the disabled button + tooltip in T7; add the "launch terminal" affordance only if owner asks — the interim is temporary.

Q6. **Backup retention policy.** `docs/skills/backups/<name>-<ts>/` grows without bound. Governance plan does not name a retention; snapshots (`data/snapshots/`) use 30-day cleanup. **Recommended default:** mirror the snapshot policy — 30-day retention, cleanup script under `apps/core/scripts/prune-skill-backups.sh` invoked from the same 04:00 launchd cron.

Q7. **Chronicler re-render on publish.** Governance plan §7 stage 7 mentions "chronicler re-renders the page — the skill status shows matches production". Since `GOSLEEP_KEEP_STATIC_SITE` is off by default (Preact-SSG deprecated, GSL-270), the source of truth is live `apps/web` — the SSE broadcast + TanStack Query invalidation (T7) already provides "re-render". **Recommended default:** drop the chronicler leg from acceptance criteria; the SSE flip is the modern equivalent.

**Total open questions for morning digest: 7. Recommended defaults are conservative and reversible.**

---

## 6. Sources

* `docs/plans/skills-governance-plan.md` — 7 stages, agreed with the owner 2026-08-03 (`d-2026-08-03-003`). Russian.
* `docs/reports/web-harness-research-2026-08-03/target-architecture.md` — §7 (layered auth), §4.3 (skills table), §9 step 7, §10 (walkthrough).
* `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` — Delta 4 (TouchID `.app` bundle), Delta 8.1 (fleet), Delta 10 (SessionAdapter).
* `docs/prd/01-phase7-interactive-control-plane.md` — Phase 7 layout template; § "Moved to the skills-management phase (d-2026-08-08-002)" identifies the re-parented items.
* `docs/lab/decisions/log.jsonl` — `d-2026-07-20` (inversion), `d-2026-08-02-004` / `d-2026-08-03-002` / `d-2026-08-03-003` (governance plan lifecycle), `d-2026-08-08-002` (Phase 7 rescope), `d-2026-08-09-001` (TouchID pause), `d-2026-08-09-002` (GSL-174 next focus), `d-2026-08-09-005` (night autonomy).
* `CLAUDE.md` — "Skill source of truth" + Safety rules + monorepo layout + Phase 8 code contact points.
* `~/.claude/CLAUDE.md` — language rule (English artifacts, PRD `NN-phaseMM-slug.md`).
* `install.sh` — verbatim guard (stderr banner + `exit 1` before `rsync`).
* `apps/core/src/routes/actions.ts` / `read.ts` — endpoint inventory (9 POST, 11 GET); `apps/core/src/actions/spawn.ts` — spawn helper contract; `apps/core/src/db/schema.ts` — skills table shape; `apps/core/bin/touchid-gate.app/` + `tty-confirm.sh` — auth-leg building blocks; `apps/web/src/router.tsx` + `AppShell.tsx` — six existing route children + wildcard NotFound (GSL-295).
* `docs/reports/verifications/GSL-250/runs/01/assets/skills-route-redirected-to-overview.png` — verifier evidence for GSL-287.

---

*End of plan.*
