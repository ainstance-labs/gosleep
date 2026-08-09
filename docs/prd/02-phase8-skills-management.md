# PRD — Phase 8: skills management system

> **Status:** Draft — 2026-08-10 (per-phase file, sibling of Phase 7)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Epic:** [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174)
> **Design source of truth:** `docs/plans/skills-governance-plan.md` (Russian, owner-approved 2026-08-03, decision `d-2026-08-03-003`) — the seven-stage plan and the four-layer defense
> **Additional architecture sources:** `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 7 (layered auth) + `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 4 (TouchID `.app` bundle)
> **Execution plan (this worker's read of the epic):** `docs/reports/skills-management-plan-2026-08-10/plan.md`
> **Parent PRD:** `docs/prd/PRD-gosleep-evolution.md` (Phases 1-6, historical archive)
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07). The design source doc stays Russian as a historical reference — this PRD supersedes it as the working spec.

---

## Positioning: Phase 8 is the working system for the skills mandate

The "lesson → skill edit" loop worked for 30 days and stopped on 2026-07-10 — nothing in the harness *required* an agent to record what it just learned back into the instruction it was following. The governance plan agreed on 2026-08-03 restores the loop with a safety envelope the owner accepted: developing a skill is work with a development copy in the repository (`skill/<name>/`); production (`~/.claude/skills/<name>/`) is edited **only** by the owner via a single button; agents cannot mutate production by four independent layers of defense.

Phase 8 is the delivery of that envelope end-to-end. It plugs into the Phase 7 control plane (feature-complete after GSL-297): the Skills page becomes the second write area (after the manual snapshot from GSL-298), and the publish endpoint reuses the exact three-layer write envelope every other action already uses — `requireBearer` middleware, per-endpoint `serialize` mutex, `withTimeline` idempotency + ledger.

**Terminology.** The full name of this system is «система управления скилами» / *skills management system*. Never the shorthand "skills" — owner rule, memory `terminology-skills-management-system.md` (2026-08-07). This PRD is written to keep both the meaning ("who edits what, who publishes, with what evidence") and the safety inversion visible.

---

## Goal

The owner can publish a single named skill from `~/.claude/skills/<name>/` end-to-end without ever handing an agent the ability to mutate production. Every publish leaves: a git commit under the epic branch (skill development), a CHANGELOG row (`docs/skills/CHANGELOG.jsonl`), a production backup (`docs/skills/backups/<name>-<utc-ts>/`), a `skills` table row (SQLite projection), and a timeline event chain (`skills.publish.started` → `.confirmed` → `.snapshotted` → `.published` or `.denied` / `.timedout`). The four-layer defense — CLAUDE.md rule, `publish.sh` owner check, production test-guard in `tools/lab/smoke.sh`, `install.sh` guard (already on since 2026-07-20) — all remain intact through every ticket.

---

## Scope

| In | Out (and why) |
|---|---|
| **Skills changelog registry.** `docs/skills/CHANGELOG.jsonl` (append-only JSONL) + `tools/skills/schema/changelog.schema.json` + `tools/skills/validate-changelog.sh`; opt-in wire-up in `tools/lab/smoke.sh`. The JSONL is authoritative; the SQLite `skills` table is a projection (Q3 of the plan risks — mirrors the events → SQLite pattern in Phase 7). | Bulk `install.sh` sync — excluded by construction. `--all` does not exist in `publish.sh`. |
| **Pre-publish sanity check.** `tools/skills/verify-local.sh <name>` — SKILL.md present + non-empty, referenced files under `references/` readable, working tree clean for the target skill dir. Called by `publish.sh` before rsync. | Cross-project promotion (a gsd-* skill into this repo, or vice versa). Bidirectional Jira sync of lessons. |
| **Publish CLI, TTY-confirm interim.** `tools/skills/publish.sh <name>` — accepts exactly one named skill (refuses `--all`, zero-arg, multi-arg). Owner gate: `isatty(0)==true` OR `$GOSLEEP_WEB_TOKEN` matches the per-request nonce the endpoint spawns with. On confirm: `verify-local.sh` → backup (`cp -a`) → `rsync -a --delete skill/<name>/ ~/.claude/skills/<name>/` → CHANGELOG row (published). TouchID leg is a single `TODO` next to the TTY branch until `d-2026-08-09-001` lifts. | Automatic publish without an owner gesture. Any mutation of `~/.claude/skills/` from anywhere outside `publish.sh`. |
| **Skills registry writer.** `apps/core/scripts/record-publish.ts` — reads CHANGELOG.jsonl, computes per-skill state (`last_published_at`, `last_published_by`, `version` = trailing SHA-4, `status` = `published`/`draft`/`clean`), upserts into `skills`. Idempotent full re-fold at boot; incremental single-row write from `publish.sh`. | Editing the global copy of `orchestrating-delivery-agents` tonight — per `d-2026-07-20`, only explicit owner-driven edits. |
| **Publish HTTP endpoint.** `POST /actions/skills/publish` — Bearer + Origin + Idempotency-Key + `serialize("skills.publish", …)` + `withTimeline`. Spawns `bash tools/skills/publish.sh <name>` with `env GOSLEEP_WEB_TOKEN=<per-request nonce>` and a 60-second ceiling; emits `skills.publish.*` events on SSE. | TouchID wiring into the live path (GSL-288) — deferred until `d-2026-08-09-001` lifts. |
| **Read-only diff endpoint.** `GET /skills/:name/diff` — Bearer-gated, per-name serialised, 5-second in-process cache: `{name, hasChanges, diffText, hashLocal, hashProd, changelog[]}`. Enriches `GET /skills` with a `status` field computed from filesystem hashes + registry state. | Real-time diff subscription (out of scope — TanStack Query polling + SSE invalidation on publish is enough). |
| **Skills web screen.** `apps/web/src/screens/Skills.tsx` + route child `{path:"skills"}` + NAV entry. Rows list every skill (including production-only `tmux-agents-orchestration` until stage 1 lands, shown as `no development copy — publish blocked`), status badge, `last_published_at`, `last_published_by`. Details drawer with diff and CHANGELOG. Publish button visible on rows with changes; **disabled with tooltip** `TouchID paused — publish via CLI: bash tools/skills/publish.sh <name>` per `d-2026-08-09-001`. SSE subscription to `skills.publish.*` for real-time status flip. | Live steering (`--dangerously-load-development-channels`) surfaces — belongs to the Channels v1.1 epic under GSL-250. |
| **Production test-guard.** `tools/lab/smoke.sh` captures baseline `sha256sum` over `~/.claude/skills/` at start (only when `GOSLEEP_SKILLS_GUARD=1`, opt-in tonight, always-on after stage 1). Recomputes at end; if any hash changed AND no matching CHANGELOG row appeared **keyed on `intent_id`** in the same run, fails with code 1 + a diagnostic. Fourth layer of the defense. | Automatic reverse-sync from production into `skill/` — reverse-sync is O1, owner-gated. |
| **Zero-diff content edits (GSL-186, GSL-189).** Local-only edits to `skill/handoff/`, `skill/delivery-workflow/`, and `CLAUDE.md` since those skills are currently zero-diff against production and safe to touch pre-stage-1. | Content edits on `skill/orchestrating-delivery-agents/` or `skill/using-jira/` — blocked by the authority inversion until O1 (`GSL-251`) lands with the owner's sanction. |

---

## Success criteria

- **F8-S1 (registry).** `docs/skills/CHANGELOG.jsonl` exists at HEAD (empty for tonight), `tools/skills/schema/changelog.schema.json` documents the seven required fields (`ts`, `skill`, `task`, `commit`, `lesson`, `status`, `intent_id`), and `tools/skills/validate-changelog.sh` fails deterministically on a corrupt row; `tools/lab/smoke.sh --skills` (or the same guard flag) invokes it and fails the run when validation trips.
- **F8-S2 (publish.sh gate).** The CLI refuses to run in agent-in-pipe context (`isatty(0)==false` AND no `$GOSLEEP_WEB_TOKEN`) with exit code 3 and a diagnostic naming the gate; succeeds under an owner TTY on `y`; produces a backup, an rsync, a CHANGELOG row with `status: published`, and a `skills.publish.published` event; `--all`, zero-arg, and multi-arg invocations exit non-zero with a usage message. TouchID leg is a `TODO` next to the TTY branch; the code path is one function call away.
- **F8-S3 (verify-local + test-guard).** `verify-local.sh <name>` returns non-zero on a broken references file or an unclean working tree, zero otherwise; the production test-guard (opt-in flag) fails when a file in `~/.claude/skills/` mutates without a matching CHANGELOG row keyed on the same `intent_id` as the publish that made the change.
- **F8-S4 (POST endpoint).** `POST /actions/skills/publish` appears in the eight-endpoint grep and returns 200 with `{ok:true, intent_id, cached, result}` on success; broadcasts `skills.publish.started`, `.confirmed`, `.snapshotted`, `.published` (or `.denied` / `.timedout`) via SSE within a second of the state change; Idempotency-Key double-post replays the original result without re-running the spawn.
- **F8-S5 (Skills screen).** `http://127.0.0.1:7331/skills` renders seven rows (six from `skill/` plus production-only `tmux-agents-orchestration`), each with a status badge, last-publish tuple, and a clickable details drawer that shows the diff (`GET /skills/:name/diff`) and CHANGELOG history; the Publish button is disabled with the TouchID-paused tooltip per `d-2026-08-09-001`.
- **F8-S6 (writer + reader).** `apps/core/scripts/record-publish.ts` populates the `skills` table on publish and re-folds idempotently at boot; `GET /skills` (already present since GSL-263) returns the populated rows; the Skills screen updates in real time via SSE invalidation.
- **F8-S7 (acceptance on a live lesson).** Deferred — this is the O11 owner-gated ticket. A real lesson walks development commit → CHANGELOG draft row → panel diff → owner clicks → TouchID (once `d-2026-08-09-001` lifts) → snapshot + rsync + CHANGELOG published row. Verification report lands under `docs/reports/verifications/GSL-174/runs/01/` per memory `verification-report-runs-format.md`.

---

## Requirements

- **R8.1 — The owner-gesture layer is non-optional.** No path anywhere in the codebase writes to `~/.claude/skills/<name>/` without passing through `publish.sh`, which cannot proceed without either an interactive TTY confirmation from the owner or a per-request env-nonce the web endpoint generates. Agents (in-pipe stdin, no TTY) fail both gates and receive exit code 3. Acceptance: F8-S2, F8-S3.
- **R8.2 — The four-layer defense stays intact through every ticket.** Layer 1: prose rule in `CLAUDE.md` "Skill source of truth" (already present); Layer 2: `publish.sh` owner check (F8-S2); Layer 3: production test-guard in `tools/lab/smoke.sh` (F8-S3); Layer 4: `install.sh` guard (already on since 2026-07-20). Any PR that weakens a layer without owner-approved rationale is rejected. Acceptance: F8-S3.
- **R8.3 — The Skills page is a live read of filesystem state, not a stale mirror.** Row status is computed at read time from `find`+`sha256sum` over the two trees (bounded to <200 KB per call), not from a cached `skills.status`. Publish events invalidate the TanStack Query cache within one SSE round-trip. Acceptance: F8-S5, F8-S6.
- **R8.4 — Publish is idempotent + auditable.** The `Idempotency-Key` on `POST /actions/skills/publish` deduplicates double-clicks (both browser-side `disabled={isPending}` and server-side `withTimeline` replay). Every publish emits a full event chain to the timeline; the `server_intents` row survives crashes. Acceptance: F8-S4.
- **R8.5 — Registry is git-tracked and human-readable.** `docs/skills/CHANGELOG.jsonl` is the source of truth; the `skills` SQLite table is a projection that rebuilds from the JSONL at boot. A hand edit to the JSONL survives a fresh clone + `bun run migrate` + first-boot re-fold. Acceptance: F8-S1, F8-S6.
- **R8.6 — Authority inversion is respected during the transition.** Content edits to `orchestrating-delivery-agents` and `using-jira` do not land tonight — the global copy is authoritative until O1 (`GSL-251`) reverse-syncs the drift with owner sanction. Zero-diff skills (`handoff`, `delivery-workflow`, `remote-control`) are safe to edit and pointwise-sync per the CLAUDE.md rule. Acceptance: T8, T9 land tonight; O2..O8 land after O1.

---

## Tasks (epic `[Skill][Process][Web] Skills management system`, GSL-174)

The 21-child backlog under GSL-174 was assembled from two streams (see the epic description) and the five re-parented verifier tickets from Phase 7. Tonight ten are buildable autonomously; eleven are owner-gated. Full inventory + rationale: `docs/reports/skills-management-plan-2026-08-10/plan.md` section 4.

**Tonight (buildable autonomously, dependency order):**

1. GSL-252 — [Docs][Skill] registry file + schema + validator (T1).
2. GSL-254 (partial) — [Tooling][Skill] `verify-local.sh <name>` (T2).
3. GSL-292 — [Web][Skill] `record-publish.ts` writer + boot re-fold (T4).
4. GSL-253 (partial) — [Tooling][Skill] `publish.sh` TTY-interim (T3).
5. GSL-255 (partial) — [Web][Skill] `GET /skills/:name/diff` (T6).
6. GSL-286 + partial GSL-266 — [Web] `POST /actions/skills/publish` + spawner (T5).
7. GSL-255 (rest) + GSL-287 — [Web][Skill] Skills screen + route + NAV (T7).
8. GSL-186 — [Skill] handoff path + wiki + dev_history filename (T8).
9. GSL-189 — [Docs][Process] shift-checklist rule for skill edits (T9).
10. GSL-254 (rest) — [Tooling][Skill] production test-guard in `smoke.sh` (T10).

**Owner-gated (do not start tonight):**

- GSL-251 (folds GSL-190) — reverse-sync O1 stream, requires explicit owner sanction (`d-2026-07-20` inversion).
- GSL-182, GSL-183, GSL-184, GSL-185, GSL-187, GSL-188, GSL-256 — content edits on `orchestrating-delivery-agents` / `using-jira` blocked by O1.
- GSL-288 — TouchID wiring, blocked by `d-2026-08-09-001` pause.
- GSL-266 (rest) — enable the Publish button + e2e, blocked by GSL-288.
- GSL-257 — acceptance on a live lesson, blocked by everything above.

---

## Dependencies

- Phase 7 web control plane (feature-complete after GSL-297 on 2026-08-09) — the Skills screen extends the AppShell NAV, `POST /actions/skills/publish` reuses the three-layer write envelope, and SSE broadcasts flow through the existing broadcaster.
- Owner sanction for O1 (`GSL-251`) unblocks stream-1 content edits (GSL-182..190 minus GSL-186 + GSL-189, which are safe now).
- `d-2026-08-09-001` lift unblocks TouchID wiring (`GSL-288`) and the live Publish-button flow (`GSL-266` finalisation + `GSL-257` acceptance).

---

## Non-goals (explicit)

- Bulk `install.sh` sync — the guard stays on forever; `--all` does not exist in `publish.sh`.
- Automatic publish without an owner gesture — `publish.sh` structurally refuses on `isatty(0)==false` + missing env-nonce.
- Any mutation of `~/.claude/skills/` from outside `publish.sh` — production test-guard flags it, install.sh guard blocks the classical rsync path.
- Cross-project skill promotion (gsd-*, plugins) — out of scope.
- Bidirectional Jira sync of skill lessons — out of scope.
- Editing the global copy of `orchestrating-delivery-agents` from an agent — only the owner does that (`d-2026-07-20`).

---

## Risks + open questions

Per `docs/reports/skills-management-plan-2026-08-10/plan.md` section 5 (technical + operational risks, morning-digest questions with recommended defaults):

- Risk 1: skill drift keeps growing while stage-1 waits. Mitigation: file O1 first thing on the morning of 2026-08-10.
- Risk 2: TTY-confirm is a security regression window — mitigated on the web path by the per-request env-nonce; on the CLI path by "agents have no TTY". Named as a known gap in the T3 dev-history file; re-confirmed before O11 acceptance.
- Risk 3: production test-guard vs in-flight publish race — keyed on `intent_id`, not "any published row in this run".
- Risk 4: diff endpoint on `orchestrating-delivery-agents` may exceed 200 KB → pagination in v1.1.
- Risk 5: the seven-vs-six-skills asymmetry (`tmux-agents-orchestration` is production-only until O1) — surfaced on the Skills screen as `no development copy — publish blocked`.
- Risk 6: umbrella (`GSL-266`) + sub-verifier (`GSL-286/287/288/292`) overlap — close 286/287/288/292 as duplicates when the umbrella lands.
- Risk 7: governance plan is Russian, owner language rule is English — this PRD is the English artifact; the governance plan stays as historical Russian reference.

Morning-digest questions (with recommended defaults):

- Q1. TouchID pause lift timeline? → **default:** ship the interim vertical this week; delay O11 acceptance until the pause lifts.
- Q2. Extra defense against `--dangerously-skip-permissions`? → **default:** add a one-line `$CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` refusal in `publish.sh`.
- Q3. JSONL vs SQLite as source of truth? → **default:** JSONL authoritative, `skills` table is the projection.
- Q4. Extend O1 to seven skills explicitly? → **default:** yes; add `remote-control` even though currently zero-diff.
- Q5. Web-panel UX under TTY-interim (button vs "launch terminal" affordance)? → **default:** disabled button + tooltip.
- Q6. Backup retention policy? → **default:** mirror snapshot retention (30 days, cleanup script + 04:00 launchd cron).
- Q7. Chronicler re-render leg on stage-7 acceptance? → **default:** drop it; SSE + TanStack Query invalidation is the modern equivalent.

---

## Sources

- `docs/plans/skills-governance-plan.md` — seven stages, owner-approved 2026-08-03 (`d-2026-08-03-003`). Russian, historical reference.
- `docs/reports/web-harness-research-2026-08-03/target-architecture.md` — section 7 (layered auth), section 4.3 (skills table), section 9 step 7, section 10 (walkthrough).
- `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` — Delta 4 (TouchID `.app` bundle).
- `docs/reports/skills-management-plan-2026-08-10/plan.md` — this worker's execution plan (21-child map, dependency order, risks, open questions).
- `docs/prd/01-phase7-interactive-control-plane.md` — Phase 7 PRD layout template + the re-scope section that names the moved items.
- `docs/lab/decisions/log.jsonl` — `d-2026-07-20` (authority inversion), `d-2026-08-02-004` / `d-2026-08-03-002` / `d-2026-08-03-003` (governance plan lifecycle), `d-2026-08-08-002` (Phase 7 rescope), `d-2026-08-09-001` (TouchID pause), `d-2026-08-09-002` (GSL-174 next focus), `d-2026-08-09-005` (night-autonomy session).
- `CLAUDE.md` — "Skill source of truth" + Safety rules + monorepo layout + code contact points.
- `~/.claude/CLAUDE.md` — English artifacts rule + `NN-phaseMM-slug.md` PRD file convention.
- `install.sh` — verbatim guard (stderr banner + `exit 1` before `rsync`).
- `apps/core/src/routes/actions.ts` / `read.ts` — endpoint inventory (nine POST + eleven GET after Phase 7 close-out); `apps/core/src/actions/spawn.ts` + `mutex.ts` + `withTimeline.ts` — three-layer write envelope reused by Phase 8.
- `apps/core/bin/tty-confirm.sh` — exit codes 0/1/2/3 the TTY-interim gate keys on.
- `apps/web/src/router.tsx` + `AppShell.tsx` — six existing route children + NAV entries (Skills is the seventh).

---

*End of Phase 8 PRD.*
