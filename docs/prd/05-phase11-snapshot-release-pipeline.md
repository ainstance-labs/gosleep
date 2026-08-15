# PRD — Phase 11: snapshot-release pipeline + CHANGELOG ledger integration

> **Status:** Draft — 2026-08-15 (per-phase file; near-term half of the plugin-migration program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)
> **Design source of truth:** `docs/reports/plugin-migration-research-2026-08-15/strategy.md` sections 3A.3 (semver rules — D5) + 3A.4 (provenance flow + snapshot-release script) + 3A.6 (update flow — D9) + 5.2 (PR #307 components; CHANGELOG ledger evolution — D6).
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).

---

## Positioning: turn the packaging into a repeatable, owner-gated release loop

Phase 10 authored the initial `v0.1.0` bundles by hand. Phase 11 makes every subsequent release **owner-gated, mechanical, and provenance-anchored**. The pipeline extracts what today's `publish.sh` proved works — the four-layer defense pattern, the TTY-confirm owner gate, the per-run CHANGELOG row — and moves it one level up: instead of publishing one loose skill from `skill/` into `~/.claude/skills/`, it cuts a **snapshot release** of one or more plugin bundles from the current state of gosleep's `skill/` into the dedicated plugins repo, then tags and ledger-records the release. Between snapshots, nothing propagates — that is the stability feature (strategy section 3A.3 rule 3).

**Honest scope statement** (strategy section 3A.4 first paragraph, reproduced because it will be re-read in silence otherwise). In the interim snapshot-mirror model, provenance answers *"what version is live where, and what changed between snapshots"* — NOT *"who made each individual edit and why."* Edits still happen directly in global `~/.claude/skills/` between snapshots; a snapshot release captures the cumulative diff since the previous snapshot, not a sequence of per-edit commits. Per-edit author/reason attribution arrives only with the far-future 4B flip (strategy section 3B / F2). Phase 11 delivers what the interim genuinely delivers — a versioned, hash-anchored release history + visible inter-snapshot diffs + concrete rollback targets + real backups + packaging headroom — and states the gap out loud so no one over-claims it.

**D9 discipline is co-owned by this phase.** Strategy section 3A.6 pins the update semantics: updates are explicit and owner-run; background auto-update is suppressed for the `gosleep-plugins` marketplace; no mid-shift updates; the update runbook says "update → restart → verify." Phase 11 does not install anything, but it ships the runbook + the auto-update-suppression snippet the owner uses at Phase 12 G1.

---

## Goal

`tools/skills/snapshot-sync.sh` exists in gosleep. Invoked with either no arguments (all bundles) or a bundle name (single bundle), and gated by the same owner-confirm mechanism `publish.sh` uses (`isatty(0)==true` OR per-request `$GOSLEEP_WEB_TOKEN` nonce; TouchID leg is a marked `TODO` per d-2026-08-09-001), the script: (a) read-only-syncs each tracked skill from `~/.claude/skills/<name>/` into gosleep's `skill/<name>/` (GSL-251 pattern); (b) rematerializes the target bundle skill trees inside a local checkout of `ainstance-labs/gosleep-plugins` by copying from gosleep's `skill/`; (c) verifies the working tree; (d) bumps `version` in each affected `plugin.json` (strict semver, MINOR by default, PATCH on skill-content-only changes, MAJOR reserved for 4B / F2); (e) appends a CHANGELOG row per affected bundle to `docs/skills/CHANGELOG.jsonl` (schema extended per D6 — one row per snapshot release, distinguished from `publish.sh` publish rows by the `kind` field or the target name); (f) runs `claude plugin validate --strict` on every affected bundle; (g) creates the `{plugin-name}--v{version}` git tag via `claude plugin tag`; (h) pushes tags in the plugins repo. What it does NOT do: touch `~/.claude/**` beyond READ, install anything, update anything, run `claude plugin update`. Owner runs the update commands separately (Phase 12 or a later interim install).

CHANGELOG.jsonl schema is extended additively to carry release rows alongside publish rows (D6). `docs/runbooks/gosleep-core.md` (or a new `docs/runbooks/plugin-releases.md`) documents the owner-run update recipe (D9 discipline) and the auto-update suppression knob verified in Phase 10.

---

## Scope

| In | Out (and why) |
|---|---|
| **`tools/skills/snapshot-sync.sh <plugin?>`** — the pipeline described in the Goal, owner-gated via the same TTY-confirm / env-nonce shape `publish.sh` uses (`apps/core/bin/tty-confirm.sh` exit codes 0/1/2/3). Refuses `--all` bulk without an explicit bundle list — mirrors the `publish.sh` "no `--all`" rule. | Any use in a spawned subagent context without an owner gesture (`isatty(0)==false` AND no `$GOSLEEP_WEB_TOKEN` = exit code 3 with a diagnostic naming the gate). |
| **Semver bump discipline** — MINOR by default (any content change to a bundle); PATCH when the only change is a whitespace / documentation fix inside a SKILL.md (script picks up the hint from a `--patch` flag; owner may override at prompt time). `1.0.0` reserved for the far-future 4B / F2 productization moment (strategy section 3A.3 rule 2). | Automatic semver-bump inference from git diff — the script asks the owner "MINOR / PATCH?" during confirm; nothing computes MAJOR from a diff. |
| **CHANGELOG.jsonl schema extension (D6)** — additive: existing seven fields stay; new field `kind` with enum `["publish", "snapshot-release"]` (default `"publish"` for backward compatibility); publish rows keep pointing at loose skills, snapshot-release rows point at bundle names + `version`. `tools/skills/schema/changelog.schema.json` + `tools/skills/validate-changelog.sh` updated; validator stays green on the existing empty ledger. | Splitting the ledger into two files — strategy section 5.2 explicitly recommends the shared-ledger option; a `kind` field is enough. |
| **`claude plugin tag` invocation** as part of the release step — creates `{plugin-name}--v{version}` tag in the plugins repo working tree, pushed with `git push --follow-tags`. | Manual tagging outside the pipeline — the script owns the tag creation so mismatches (bumped `plugin.json` without tag) cannot happen. |
| **`claude plugin validate --strict` gate** on every affected bundle inside the pipeline; failure aborts the release without bumping the version or writing the CHANGELOG row. | Wiring `validate --strict` into `tools/lab/smoke.sh` — the pipeline runs it inline; `smoke.sh` stays lightweight and unchanged for this PRD's purposes. |
| **Release runbook** at `docs/runbooks/plugin-releases.md` (new file) — the owner's copy-paste recipe: (a) run `snapshot-sync.sh <bundle>`, (b) review the tag + CHANGELOG row, (c) at a shift boundary run `claude plugin update <bundle>` on the machine(s) with a pilot install, (d) restart the session, (e) verify via `claude plugin list`. Owner-run every step; agents never run install/update against user scope (strategy section 3A.6 rule 1). | Any automation of the update side (`claude plugin update`) — D9 forbids it. |
| **Auto-update suppression config note** — the runbook documents the knob verified in Phase 10 (candidate: `disableAutoUpdate` and/or `pluginRefreshFrequency` per gstack-and-ecosystem findings) with the exact settings-scope needed; if verification came back with the specific CLI/env form, the runbook uses it verbatim. | Actually flipping the knob during Phase 11 — the flip happens at Phase 12 G1 when the marketplace is registered on user scope (Phase 11 installs nothing). |
| **Web control plane emits a `skills.snapshot.release` timeline event** on script success — parallel to `skills.publish.done`, uses the existing broadcaster. Deferred to Phase 11 follow-on if the endpoint wiring is not trivial; the script MUST at minimum log a structured JSON line the chronicler can pick up. | A web-side "Snapshot release" button — no write action from the web for plugin releases in any near-term iteration; strategy section 5.1 rule "no write actions from the web for plugin install/update" applies to release cutting too. |

---

## Success criteria

- **F11-S1 (script exists + owner-gated).** `bash tools/skills/snapshot-sync.sh gosleep-delivery` under a non-TTY, no-`$GOSLEEP_WEB_TOKEN` context exits code 3 with a diagnostic naming the gate (mirrors F8-S2 for `publish.sh`). Under an owner TTY on `y`, the script executes the full flow.
- **F11-S2 (read-only global).** After a full script run, `stat -f '%Sm' ~/.claude/skills/<name>/SKILL.md` for every migrated skill is UNCHANGED. `find ~/.claude -newer <pre-run-timestamp>` shows nothing under `~/.claude/skills/`, `~/.claude/plugins/`, or `~/.claude/settings.json`.
- **F11-S3 (bundle rematerialization).** After a full script run for `gosleep-delivery`, `diff -rq skill/<name>/ <plugins-repo>/gosleep-delivery/skills/<name>/` is empty for each of the four skills in the bundle (per R10.2 composition from Phase 10).
- **F11-S4 (semver bumped).** After a `MINOR` run on `gosleep-delivery`, `<plugins-repo>/gosleep-delivery/.claude-plugin/plugin.json`'s `version` field increments by one minor (e.g. `0.1.0` → `0.2.0`); the `.claude-plugin/marketplace.json` entry for that plugin has no per-entry `version` (R10.3 from Phase 10 still holds).
- **F11-S5 (CHANGELOG row exists + validates).** After a run, `docs/skills/CHANGELOG.jsonl` has one new row per affected bundle with `kind: "snapshot-release"`, `skill: "<bundle-name>"`, `version: "<new-version>"`, `commit: "<plugins-repo-sha>"`, `ts: "<ISO8601>"`, `lesson: "<owner or auto: cumulative-diff summary>"`, `status: "released"`, `intent_id: "<uuid>"`; `bash tools/skills/validate-changelog.sh` exits 0.
- **F11-S6 (git tag exists).** `git tag --list '{plugin-name}--v*'` in the plugins repo lists `{plugin-name}--v{new-version}`; `git push --follow-tags` succeeds against the SSH remote (Phase 10 R10.10 mitigation).
- **F11-S7 (validation gate blocks a bad release).** A deliberately corrupted `plugin.json` (e.g. missing `name`) causes `claude plugin validate --strict` to fail; the script exits non-zero WITHOUT bumping the version or writing the CHANGELOG row (idempotency + atomicity — mirrors `publish.sh` behavior on `verify-local.sh` failure).
- **F11-S8 (runbook exists + is copy-pasteable).** `docs/runbooks/plugin-releases.md` documents the six-step owner recipe end-to-end. A dry-run by a fresh reader (documented in the dev_history) completes without asking any question the runbook does not answer.

---

## Requirements

- **R11.1 — Owner gate is the same shape as `publish.sh`.** Reuse `apps/core/bin/tty-confirm.sh` exit codes (0/1/2/3) so an agent-in-pipe context (`isatty(0)==false` + no `$GOSLEEP_WEB_TOKEN`) fails with code 3. TouchID leg is a `TODO` next to the TTY branch until d-2026-08-09-001 lifts (mirrors `publish.sh` GSL-253). Acceptance: F11-S1.
- **R11.2 — Global is READ-ONLY.** The global → local sync step uses `rsync -a` from `~/.claude/skills/<name>/` into `skill/<name>/` WITHOUT `--delete` against global; there is no write into `~/.claude/**` at any step. `orchestrating-delivery-agents` gets an extra explicit owner acknowledgement in the confirm prompt (strategy section 7 D7 note: read-only sync does not violate d-2026-07-20, but the extra prompt keeps the owner in the loop for this specific skill). Acceptance: F11-S2.
- **R11.3 — Rematerialization is byte-equal.** After the copy step, each bundle's `skills/<name>/` subtree equals the corresponding gosleep `skill/<name>/` subtree byte-for-byte (via `diff -rq`). `.DS_Store` and other macOS noise ignored via `--exclude`. Acceptance: F11-S3.
- **R11.4 — Semver in `plugin.json` only (strategy 3A.3 rule 1).** The bump edits ONLY `<bundle>/.claude-plugin/plugin.json`; `marketplace.json` is never rewritten to carry `version` on any entry. Bump direction: MINOR by default; PATCH on explicit flag or trivial-diff detection (whitespace / docs-only); MAJOR NEVER done here (`1.0.0` reserved for F2). Acceptance: F11-S4, F11-S7.
- **R11.5 — CHANGELOG schema extension is additive (D6).** Existing seven fields stay; add `kind` (enum `["publish", "snapshot-release"]`, default `"publish"`). `publish.sh` behavior unchanged. The schema stays valid against the existing empty ledger (and against any future publish row generated by `publish.sh` — the default value handles backward compat). Acceptance: F11-S5.
- **R11.6 — Atomic release (or nothing).** If any step after "version bump" fails, the script rolls the local edits back (a scratch checkout in the plugins repo, discarded on failure — never `git reset --hard` against a shared working tree, per no-git-stash-in-shared-tree memory). Acceptance: F11-S7.
- **R11.7 — Tag creation is owned by the script.** `claude plugin tag` runs at the end of a successful run; the tag name is `{plugin-name}--v{version}`. If the tag exists (retry after a partial failure that already tagged), the script aborts with a diagnostic naming the collision — no silent overwrite. Acceptance: F11-S6.
- **R11.8 — `~/.claude/plugins/**` is READ-ONLY.** No `claude plugin install` / `update` / `marketplace add` runs inside the script. The script may READ `~/.claude/plugins/installed_plugins.json` to enrich the CHANGELOG row `lesson` field with "installed at v{old} on this machine at the moment of the release" context — read-only. Acceptance: F11-S2 covers this.
- **R11.9 — Update discipline documented (D9).** `docs/runbooks/plugin-releases.md` states explicitly: (a) updates are owner-run only; (b) auto-update suppressed for the `gosleep-plugins` marketplace via the knob verified in Phase 10; (c) no mid-shift updates — apply at a shift boundary; (d) restart + verify with `claude plugin list`. Acceptance: F11-S8.
- **R11.10 — Timeline event or chronicler line.** On a successful release, either (a) `POST` to the existing web-control-plane broadcaster with a `skills.snapshot.release` event, or (b) at minimum write a structured JSON line to `data/logs/*.log` that the chronicler picks up. Non-blocking for the release itself; failure of the emit does NOT roll back the release. Acceptance: dev_history captures the emit sample.

---

## Tasks (parent epic `[Docs][Skill] Plugin migration PRD (near-term program)`, GSL-337; execution ticket to be filed separately when Phase 11 build begins)

Reproduced here so the future execution epic has a target list.

1. `[Skill][Tooling]` — write `tools/skills/snapshot-sync.sh`; owner-gate mirrors `publish.sh`; refuses agent-in-pipe context; supports `<plugin?>` positional arg.
2. `[Docs][Skill]` — extend `tools/skills/schema/changelog.schema.json` with `kind` field (enum, default); regenerate + update `tools/skills/validate-changelog.sh` if needed; add a fixture test.
3. `[Skill][Tooling]` — pipeline steps a-h in the script: read-only global → `skill/`; copy `skill/` → `<plugins-repo>/<bundle>/skills/`; verify clean; bump `plugin.json`; append CHANGELOG row; run `plugin validate --strict`; run `plugin tag`; `git push --follow-tags`.
4. `[Skill][Tooling]` — atomic-release safety (scratch checkout in the plugins repo; rollback on failure; never `git reset --hard` on a shared working tree; never `git stash`).
5. `[Docs][Skill]` — write `docs/runbooks/plugin-releases.md` with the six-step owner recipe (release → tag → shift boundary → update → restart → verify), the D9 update discipline block, and the auto-update suppression snippet from Phase 10.
6. `[Web][Skill]` (optional; can be split off) — emit `skills.snapshot.release` timeline event on release success (or fall back to structured JSON log line).
7. `[Docs][Skill]` — dev_history entries per task + index update.

---

## Dependencies

- Phase 10 (bundles v0.1.0 in the plugins repo). The pipeline rematerializes each bundle's skills tree; the target bundle names and layout come from Phase 10.
- Phase 9 (orphan rescue). All 12 skills must exist in gosleep's `skill/` for the copy step to cover the `gosleep-evals` bundle (which includes four of the five rescued orphans).
- `publish.sh` architecture (GSL-253 / GSL-254 tooling in PR #307). The owner-gate pattern, the `apps/core/bin/tty-confirm.sh` exit-code discipline, and the `withTimeline` event chain shape are reused; Phase 11 does not rewrite them.
- `docs/skills/CHANGELOG.jsonl` (currently 0 rows) and its schema (currently 7-name closed enum + no `kind` field). Phase 9 extends the enum to 12; Phase 11 extends the schema additively with `kind`.
- Verification items from Phase 10 F10-S7 (SSH URL acceptance in `extraKnownMarketplaces`; auto-update suppression knob). Both are read by the Phase 11 runbook, not by the script itself, but the runbook cannot be authoritative without them.

---

## Non-goals (explicit)

- Any install / update / marketplace-add invocation from the script — those are Phase 12 G1 owner commands.
- Any web-side Publish button that maps to `snapshot-sync.sh` — the button will not exist in Phase 11 (may be considered in a much later interim epic behind TouchID; explicitly out of scope here).
- CI wiring on either repo — the pipeline runs locally, `plugin validate --strict` is the gate, dev_history is the receipt.
- Multi-machine snapshot cadence — cadence is owner-set per release; the script does not schedule itself.
- Per-edit provenance (author/reason per individual global edit) — impossible in the interim model (strategy section 3A.4 honest scope statement); the CHANGELOG row records the cumulative diff since the previous snapshot, not per-edit history.
- Automatic MAJOR version bump — the script never picks `MAJOR`; `1.0.0` requires the F2 productization decision.

---

## Risks + open questions

- Risk 1 — the script drifts from `publish.sh` semantics (e.g. exit codes stop mirroring `tty-confirm.sh`). Mitigation: reuse the binary, not a re-implementation; F11-S1 acceptance keys on identical exit codes.
- Risk 2 — CHANGELOG schema extension breaks a future `publish.sh` invocation. Mitigation: default value on `kind` (`"publish"`), existing schema fields unchanged; F11-S5 acceptance runs the validator against a hand-crafted `publish` row without `kind` and asserts pass.
- Risk 3 — `git reset --hard` in the plugins repo working tree could destroy owner edits landed between snapshots (once G3 makes the plugins-repo folder the editing home for the 12). Mitigation: R11.6; the pipeline uses a scratch checkout under `data/` or a temp dir; the shared plugins-repo working tree is only touched by additive commits.
- Risk 4 — the auto-update suppression knob differs between `claude 2.1.233` and the version installed on the owner's machine at execution time. Mitigation: the Phase 10 verification item re-runs at every fresh execution environment; the runbook explicitly says "re-verify the knob at your CLI version."
- Risk 5 — snapshot staleness (owner cuts snapshots infrequently; installed pilot bundles fall further behind global). Mitigation: strategy section 5.1 web indicator ("newer snapshot available") is the surfacing story; Phase 11 emits the timeline event that the indicator would read.
- Risk 6 — the pipeline runs into a plugins-repo history that has diverged (someone else committed manually). Mitigation: the script does `git fetch && git rebase --autostash=no` — refuses to proceed if divergence exists; owner resolves manually before re-running.
- Risk 7 — release-time `orchestrating-delivery-agents` read fires the extra owner-acknowledgement prompt and the owner cancels partway. Mitigation: cancel is safe (the atomic-release rollback in R11.6); no partial state persists.

Open questions (recommended defaults for the execution ticket):

- Q1. Where does the script live? `tools/skills/snapshot-sync.sh` or `tools/skills/plugin-release.sh`? → **default:** `snapshot-sync.sh` (matches strategy naming).
- Q2. Scratch checkout location for atomic release safety? → **default:** `data/tmp/plugin-release-<uuid>/` (data/ is git-ignored per CLAUDE.md).
- Q3. Auto-detect PATCH-only diffs (whitespace / docs)? → **default:** no in v1 — always prompt MINOR/PATCH at owner-confirm time.
- Q4. Emit `skills.snapshot.release` timeline event or defer? → **default:** implement the fallback (structured JSON log line the chronicler picks up); wire the event into the broadcaster in a follow-on ticket if it needs any web-side work.
- Q5. Include a `--dry-run` flag? → **default:** yes; prints the plan (which bundles, which bump, which rows) without touching anything.

---

## Sources

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — sections 3A.3 (semver rules D5), 3A.4 (provenance flow + snapshot-release script + honest scope), 3A.6 (update flow D9), 5.1 (web indicator; no write actions), 5.2 (PR #307 evolution + CHANGELOG D6 shared ledger), section 6 risks 3-4-8-11, section 7 D5-D6-D7-D9.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — sections 3.4 (CHANGELOG schema state) + PR #307 component list.
- `apps/core/bin/tty-confirm.sh` — reused for the owner gate (exit codes 0/1/2/3).
- `tools/skills/publish.sh` — reference architecture (owner gate, `verify-local.sh` call, `record-publish.ts` writer, CHANGELOG append pattern).
- `tools/skills/schema/changelog.schema.json` + `tools/skills/validate-changelog.sh` — extended additively.
- `docs/lab/decisions/log.jsonl` — `d-2026-07-20` (authority inversion; `orchestrating-delivery-agents` global-authoritative), `d-2026-08-09-001` (TouchID pause), `d-2026-08-09-005` (night-autonomy session).
- `CLAUDE.md` — "Skill source of truth" + `data/` is git-ignored + `install.sh` disabled; monorepo layout.
- Public docs referenced by findings: `code.claude.com/docs/en/plugins-reference` (`plugin validate --strict`, `plugin tag`).

---

*End of Phase 11 PRD.*
