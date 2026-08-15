# PRD — Phase 12: global-scope soft transition G1-G4

> **Status:** Draft — 2026-08-15 (per-phase file; near-term half of the plugin-migration program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)
> **Design source of truth:** `docs/reports/plugin-migration-research-2026-08-15/strategy.md` sections 4A-G G1-G4 (owner-refined global-scope sub-plan, 2026-08-15) + 1.4 (namespaced coexistence, the fact the whole soft transition rests on) + 3A.6 (D9 update discipline) + 4B boundary line.
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).
> **Trial length:** ~1 month, owner-stated (strategy Owner refinement paragraph).

---

## Positioning: the lightweight owner-only workflow flip for the global scope

Phase 12 executes the strategy's 4A-G sub-plan: four owner-gated steps that walk the 12 owner-authored skills, **on the owner's machine only** and **only after G4 lands**, from "loose global, edited in `~/.claude/skills/`" to an end-state where plugin-namespaced invocation is the primary path for the migrated 12, edits land in the `ainstance-labs/gosleep-plugins` repo folder, and loose global copies are archive-moved to a dated backup. The end-state is a G4-completion claim, not a mid-phase claim — through G1 the loose skills remain the primary path; G2 only adds a selection-preference stub; G3 is a trial that can be aborted with a `git`-tracked revert; only at G4 does the primary-path flip actually happen. At every step, coexistence is real (strategy section 1.4 quoted from the official docs: "the original `/skill-name` and the plugin copy both remain available rather than one overriding the other"), so no cutover cliff exists.

**Boundary line, restated so it is not blurred.** Phase 12 is a **lightweight owner-only workflow flip for the global scope** on the owner's machine — one user, one machine, edits in a git-tracked folder, plugin cache updated by `claude plugin update`. It does NOT require gosleep to be a "full PRODUCTION system," because the "contribution flow" inside G4 is just *"own a folder, edit it, run two commands."* The heavyweight full gosleep-harness inversion (contribution flows through gosleep-as-product with PR-based ceremony, CI, evals, multi-project consumers) STAYS far-future 4B, gated on gosleep = full PRODUCTION plus a separate owner decision (strategy sections 4A-G boundary line, 4B).

**Every one of G1-G4 is a distinct owner gate.** No step chains into the next automatically. G3's ~1-month trial has its own start-date decision; G4's archive-move waits on an explicit end-of-trial go/no-go.

---

## Goal

By the end of Phase 12 G4, on the owner's machine:

- All three `gosleep-*` plugin bundles are installed at user scope; both invocation forms (`handoff` and `gosleep-delivery:handoff`) resolve simultaneously (strategy section 1.4 coexistence fact).
- Each of the 12 loose global SKILL.md files has an owner-approved deprecation stub line at its head, steering selection toward the plugin invocation (**the ONE sanctioned near-term write to `~/.claude/skills/`**, per strategy section 4A-G G2).
- A ~1-month trial completes cleanly: real work exercises the plugin invocations, any lesson worth writing lands in `<plugins-repo>/gosleep-*/skills/<name>/SKILL.md` (edits directly in the marketplace repo folder — from G3 onward the marketplace repo folder IS the editing home for the 12), release cadence runs through Phase 11's `snapshot-sync.sh`, and `claude plugin update` at shift boundaries propagates the edits into the plugin cache.
- On owner sign-off after the trial, the 12 loose global skill directories are **archive-moved** (never `rm`) by the owner personally to `~/.claude/skills/_deprecated-YYYY-MM-DD/<name>/` (or equivalent owner-chosen path). Any regret is one `mv` back.

Global auto-update stays suppressed for the `gosleep-plugins` marketplace throughout (D9). No mid-shift plugin updates. `~/.claude/skills/**` is READ-ONLY for agents at every step **except** the specifically sanctioned G2 stub-add and the owner's own G4 archive-move.

---

## Scope

| In | Out (and why) |
|---|---|
| **G1 — parallel install of 3 bundles at user scope.** Owner runs `claude plugin marketplace add <plugins-repo>` (SSH URL) then `claude plugin install gosleep-delivery@gosleep-plugins`, `... gosleep-orchestration@ ...`, `... gosleep-evals@ ...`. Verified by `claude plugin list` showing all three at v0.1.0. | Any agent-driven install — Claude Code writes the plugin cache when the owner runs the install commands; the owner IS the gate. |
| **G2 — deprecation stubs added to 12 loose global SKILL.md.** One line per file, form (per strategy section 4A-G G2): `> **Deprecated (2026-08-XX):** superseded by \`<bundle>:<skill>\`; use the plugin version.` Applied to the seven tracked skills + the five orphans (Phase 9 rescued) — same 12-skill inventory. | Deletion or content-mutation of the loose files beyond adding the stub line — the loose skills continue to resolve and run; only the frontmatter guidance shifts selection preference. |
| **G3 — ~1-month trial with edits landing in `<plugins-repo>/gosleep-*/skills/<name>/`.** Any lesson worth writing goes into the marketplace repo folder; owner runs `bash tools/skills/snapshot-sync.sh <bundle>` (Phase 11) to release the version bump + CHANGELOG row + tag, then at a shift boundary runs `claude plugin update <bundle>` + session restart. Loose global copies are NOT edited during the trial (the G2 stub already steers away). Trial produces the first real per-edit history (commits, tags, ledger rows). | Any mid-shift update; any agent running `claude plugin update`. |
| **G4 — owner archive-moves the 12 loose global copies.** Executed by the owner personally: `mv ~/.claude/skills/<name> ~/.claude/skills/_deprecated-YYYY-MM-DD/<name>` (or owner-chosen path). Preserves a final rollback layer (any regret is one `mv` back). | Any agent running the `mv`; any `rm -rf` (even after archive). Rollback is `mv` back — reinstall from the plugins repo (all 12 tracked as of Phase 9). |
| **Auto-update suppression config landed on user scope (D9)** — the knob verified in Phase 10 (candidate: `disableAutoUpdate` and/or `pluginRefreshFrequency`) is set for the `gosleep-plugins` marketplace at G1, exactly once, by the owner. Snippet lives in the Phase 11 runbook and here. | Any auto-flip of the knob by an agent. |
| **`orchestrating-delivery-agents` per-skill go/no-go at G3** (strategy section 7 D7). Recommended: include it in G1/G2 like the others, but flag G3 as a per-skill check-in given its size (~1497 lines) and gosleep-lacing. Owner decides at trial start whether it joins the trial or is kept globally-authoritative and archive-moved last (or never). | Any silent assumption on either side — the decision is explicit in a Jira comment or the dev_history of the G3 execution ticket. |
| **`skill/README.md` + gosleep `CLAUDE.md` "Skill source of truth" update** at G4 completion: reflects that on the owner's machine, the marketplace repo folder is now the editing home for the 12; the loose global copies are archived; the standing safety rule remains in force (agents never write `~/.claude/**` unsanctioned; the archive-move was an owner-only exception per G4). | Any pre-G4 rewrite of the source-of-truth wording — through G3 the wording still reflects global as authoritative for edits (G3 is a trial; if aborted, the world reverts). |
| **Skills-screen coexistence view (optional, Phase 12 follow-on).** Strategy section 5.1 sketch: the existing Skills page can gain a small badge per skill showing "loose global present / plugin installed / deprecation stub applied" during G1-G3. Not blocking. | A full plugin-management UI — the update path stays owner-run CLI (strategy section 3A.6). |

---

## Success criteria

- **F12-G1-S1 (bundles installed).** After G1: `claude plugin list` (or reading `~/.claude/plugins/installed_plugins.json`) shows `gosleep-delivery@gosleep-plugins`, `gosleep-orchestration@gosleep-plugins`, `gosleep-evals@gosleep-plugins`, each at `version: 0.1.0`, `scope: "user"`, `gitCommitSha` set. Both `handoff` (bare) and `gosleep-delivery:handoff` resolve in a fresh Claude Code session (verified by `/skills` output or equivalent).
- **F12-G1-S2 (auto-update suppressed).** The knob verified in Phase 10 is set for the `gosleep-plugins` marketplace on user scope. `claude plugin list` refresh does NOT auto-bump versions between sessions (verified by running a session, cutting a release in the plugins repo bumping the local checkout ONLY, and confirming the installed version does NOT change until the owner runs `claude plugin update`).
- **F12-G2-S1 (stubs applied).** Every one of the 12 loose global `SKILL.md` files has exactly ONE new line at its head matching the deprecation-stub form (strategy section 4A-G G2). `git diff` shows one-line additions across 12 files (in an owner-run diff tool since the files are not tracked by any repo — the receipt is the before/after `sha256sum` list captured in the dev_history of the G2 execution ticket). No other content in any file changed. The five orphans (Phase 9 rescued) each carry the stub too — the 12-skill inventory is complete.
- **F12-G2-S2 (safety-rule caveat honored).** G2 is executed by the owner personally, OR by an agent under an explicit logged owner sanction with the script hard-scoped to the 12 named files (`--allow-list agentic-report-creator,…,verifier-skeptic,handoff,…`). No third file was written under `~/.claude/skills/**`. The standing d-2026-07-20 rule remains in force post-G2.
- **F12-G3-S1 (trial produces real edit history).** After the trial: `git log <plugins-repo>/gosleep-*/skills/<name>/SKILL.md` shows N > 0 commits for at least K > 0 of the 12 skills (K depends on what the trial exercised; the acceptance is "not zero"). Each edit has an author, a timestamp, a GSL-key commit message. `CHANGELOG.jsonl` in gosleep has M > 0 `kind: "snapshot-release"` rows accumulated during the trial.
- **F12-G3-S2 (loose globals untouched during trial).** After the trial: `sha256sum ~/.claude/skills/<name>/SKILL.md` for each of the 12 equals the checksum captured at G2 completion (the G2 stub is the last edit made to any of these files during the trial).
- **F12-G3-S3 (D9 discipline held).** Zero mid-shift plugin updates during the trial. Every `claude plugin update` was run at a documented shift boundary (dev_history entries per update event).
- **F12-G4-S1 (archive-move done by owner).** After G4: `ls ~/.claude/skills/_deprecated-YYYY-MM-DD/` (or the owner-chosen archive path) lists the 12 skill directories, byte-equal (via `diff -rq`) to the state captured at G2 completion — plus the deprecation stub line added at G2. `ls ~/.claude/skills/ | grep -E '^(handoff|delivery-workflow|writing-prds|…|verifier-skeptic)$'` returns nothing (the 12 names are gone from the loose surface).
- **F12-G4-S2 (rollback proven).** In the dev_history of the G4 execution ticket, one skill is `mv`-back-and-forward as a proof-of-rollback: `mv .../\_deprecated-.../handoff .../handoff` restores the loose `/handoff` invocation; `mv` back to the archive restores the G4 state. The plugin invocation continues to resolve throughout.
- **F12-cross (docs updated).** `skill/README.md` and gosleep `CLAUDE.md` "Skill source of truth" section reflect the G4 completion state: the marketplace repo folder is the editing home for the 12 on this machine; loose global copies are archived at `<path>`; agents still never write `~/.claude/**` unsanctioned; the standing safety rule is unchanged; the far-future 4B ceremony remains gated on gosleep = full PRODUCTION + a separate owner decision.

---

## Requirements

- **R12.1 — Every step is a distinct owner gate.** No step chains automatically into the next. G1 → G2 waits on explicit owner approval. G2 → G3 waits on explicit trial-start date. G3 → G4 waits on explicit end-of-trial go/no-go. If the owner pauses at any gate, the world stays at that gate's end-state safely. Acceptance: dev_history captures the four gate approvals.
- **R12.2 — Coexistence is preserved.** Strategy section 1.4 quoted verbatim: "the original `/skill-name` and the plugin copy both remain available rather than one overriding the other." G1 does not remove any loose skill; G2 only adds a stub line; G3 does not delete anything under `~/.claude/skills/`; G4 archive-moves (never `rm`). Rollback at any gate is fast and lossless. Acceptance: F12-G1-S1, F12-G2-S1, F12-G3-S2, F12-G4-S2.
- **R12.3 — G2 is THE one sanctioned near-term write.** No other agent-driven write to `~/.claude/skills/**` is authorized by this phase. The G2 stub-add script (if run by an agent under owner sanction) is hard-scoped to the 12 named files via an allow-list; a rogue call that names a 13th file fails. Acceptance: F12-G2-S2.
- **R12.4 — G3 exercises the release loop from Phase 11 exclusively.** Every edit that propagates during the trial goes through `snapshot-sync.sh` + `claude plugin tag` + owner-run `claude plugin update`. No hand-written commits to a bundle's `plugin.json` version outside the pipeline. Acceptance: F12-G3-S1 (tags exist per release; CHANGELOG rows exist per release).
- **R12.5 — D9 discipline held (strategy 3A.6).** Auto-update suppressed for `gosleep-plugins`; no mid-shift updates; every update owner-run at a shift boundary. Acceptance: F12-G1-S2, F12-G3-S3.
- **R12.6 — `orchestrating-delivery-agents` per-skill go/no-go at G3 (strategy 7 D7).** Owner decides at G3 start whether it joins the trial. Whichever way the decision goes is recorded in the G3 execution ticket. If it stays globally-authoritative, G4 for this specific skill waits on a further explicit decision. Acceptance: dev_history captures the decision.
- **R12.7 — Archive-move is a `mv`, not `rm` (G4 rollback layer).** Owner runs the `mv` personally. Path is owner-chosen; recommended pattern `~/.claude/skills/_deprecated-YYYY-MM-DD/<name>/`. No `rm -rf` under `~/.claude/skills/**` at any step of Phase 12. Acceptance: F12-G4-S1, F12-G4-S2.
- **R12.8 — Documentation reflects the actual state after each gate.** After G1: docs still name global as editable authoritative for the 12 (trial not started). After G2: docs note the stubs are in place, still authoritative for edits. After G3: docs note the trial is in progress, marketplace repo folder is the working editing home for edits during the trial, loose globals still resolve. After G4: docs note the archive-move + marketplace repo folder as the editing home for the 12 (still lightweight, still owner-only, distinct from 4B). Acceptance: F12-cross.
- **R12.9 — Boundary line honored.** G4 completion does NOT trigger any 4B step. F1 / F2 / F3 remain gated on `gosleep = full PRODUCTION` + separate owner decision + D10 evidence. Any wording in Phase 12 artefacts that reads as "we are now doing 4B" is a defect. Acceptance: text-diff review at G4 close.

---

## Tasks (parent epic `[Docs][Skill] Plugin migration PRD (near-term program)`, GSL-337; execution tickets to be filed per gate when Phase 12 build begins)

Reproduced here so the future execution epics — one per gate — have unambiguous target lists. Owner gates each execution epic in.

**G1 execution epic** — 1 task:

1. `[Skill][Process]` — owner runs `claude plugin marketplace add <plugins-repo>` (SSH) + `claude plugin install <bundle>@gosleep-plugins` for the three bundles; auto-update suppression knob applied; `claude plugin list` output pasted into dev_history.

**G2 execution epic** — 2 tasks:

1. `[Skill][Tooling]` — write the deprecation-stub-adder script (owner-run or hard-scoped agent-run) with an `--allow-list` of the 12 skill names; refuses to modify anything else; produces a one-line diff per file.
2. `[Skill][Process]` — owner (or hard-scoped agent under logged sanction) runs the script; the 12 stubs land; `sha256sum` list before/after captured in dev_history.

**G3 execution epic** — 3 tasks (over ~1 month):

1. `[Skill][Process]` — trial kickoff: explicit start date; per-skill go/no-go for `orchestrating-delivery-agents` (R12.6); trial-observation dev_history file created.
2. `[Skill][Tooling]` — Phase 11 `snapshot-sync.sh` exercised at least once per bundle during the trial; releases + tags + CHANGELOG rows accumulate.
3. `[Skill][Process]` — trial-end review: F12-G3-S1/S2/S3 acceptance evidence collected in the observation file; owner decides G4 go/no-go.

**G4 execution epic** — 1 task:

1. `[Skill][Process]` — owner runs the archive-move `mv` commands personally; proof-of-rollback demonstration on one skill; `skill/README.md` + gosleep `CLAUDE.md` "Skill source of truth" updated per F12-cross.

---

## Dependencies

- Phase 10 (bundles v0.1.0 in the plugins repo). G1 installs those bundles.
- Phase 11 (`snapshot-sync.sh` + CHANGELOG D6 extension). G3 uses this loop for every edit that propagates during the trial.
- Phase 9 (orphan rescue). The 12-skill inventory used for G2 stubs + G4 archive includes the 5 orphans.
- `d-2026-08-09-001` (TouchID pause). Does NOT block G1-G4 execution — the owner-gate mechanisms in the pipeline are TTY / env-nonce; TouchID is the future improvement.
- `d-2026-07-20` (safety rule; global-authoritative for edits; `install.sh` disabled). G2 is the ONE sanctioned near-term exception (per-skill or per-batch owner approval); G4 is an owner-personal exception (archive-move `mv`, not `rm`).
- Verification items from Phase 10 F10-S7 (SSH URL acceptance in `extraKnownMarketplaces`; auto-update suppression knob). Both are load-bearing for G1.

---

## Non-goals (explicit)

- Any 4B step (F1 cross-project cutover; F2 productized contribution ceremony; F3 legacy decommission at scale). Gated on gosleep = full PRODUCTION + separate owner decision + D10 evidence.
- Any `rm -rf` under `~/.claude/skills/**`. G4 is `mv`, always.
- Any auto-flip of the D9 auto-update suppression knob by an agent.
- Any mid-shift `claude plugin update`. Updates land at shift boundaries only.
- Any agent-run `claude plugin install` / `marketplace add` / `update`. Owner runs those.
- Any silent decision on `orchestrating-delivery-agents` at G3. The per-skill go/no-go is explicit.
- Adding cross-machine consumers (other of the owner's machines, other people). That is F1.
- Rewriting the "source of truth" wording to declare the plugins repo authoritative for edits BEFORE G3 completes.

---

## Risks + open questions

- Risk 1 — G2 stub-adder script escapes its allow-list and modifies a 13th file (e.g. a gstack skill). Mitigation: R12.3; the script hard-fails on any name not in the allow-list; dev_history captures the allow-list verbatim.
- Risk 2 — coexistence assumption breaks in some Claude Code future version (`plugin-name:skill-name` and bare `skill-name` stop resolving simultaneously). Mitigation: strategy section 1.4 quotes the official doc verbatim; if the doc changes, G3 aborts and G4 is deferred. Detection: the G3 observation file logs the first session per week that resolves both names — a regression surfaces there.
- Risk 3 — the trial gets sparse activity and G3 evidence (F12-G3-S1: N > 0 commits, M > 0 releases) is weak. Mitigation: G3 kickoff commits to at least one deliberate release per bundle during the trial, even if no real lesson triggers it (e.g. a trivial docs edit). The point is exercising the loop end-to-end.
- Risk 4 — `orchestrating-delivery-agents` decision at G3 is deferred repeatedly and G4 for the other 11 stalls. Mitigation: R12.6 allows G4 to proceed for the 11 while `orchestrating-delivery-agents` remains globally-authoritative if that is the owner's choice. Explicitly a supported end-state.
- Risk 5 — private-repo credential failure (strategy section 6 risk 6) surfaces at G1. Mitigation: SSH remote per Phase 10 R10.10 + `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` env; D9 suppresses background auto-update regardless.
- Risk 6 — the archive path chosen at G4 collides with a future gstack update (e.g. gstack chooses `_deprecated-*` as a folder name). Mitigation: recommended pattern uses a dated suffix; owner picks the exact path at G4 time; dev_history records it.
- Risk 7 — G2 stub wording bit-rots (bundle name changes, invocation form changes). Mitigation: strategy section 6 risk 1 — plugin `name` is immutable once shipped; the stub wording keys on names locked at Phase 10.

Open questions (recommended defaults for the G1/G2/G3/G4 execution epics):

- Q1. G2 stub text override? → **default:** the exact form in the strategy section 4A-G G2 body; date-stamped at execution time.
- Q2. `orchestrating-delivery-agents` in G1/G2? → **default:** yes, include it; keep the G3 per-skill go/no-go as the explicit gate for whether it enters the trial.
- Q3. Skills-screen coexistence view (Phase 12 follow-on)? → **default:** defer; not blocking; a small badge is a nice-to-have.
- Q4. G3 length? → **default:** 30 days from the explicit kickoff date; owner may extend once with a documented reason.
- Q5. G4 archive path? → **default:** `~/.claude/skills/_deprecated-<UTC-YYYY-MM-DD>/`; owner overrides at execution.

---

## Sources

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — sections 1.4 (coexistence quote), 3A.6 (D9 update discipline), 4A-G G1-G4 (full sub-plan body), 4B boundary line, section 6 risks 5-6-7-11-13, section 7 D7-D9.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — sections 1 + 1.5 (12-skill inventory), 3 (`installed_plugins.json` extant with 3 marketplaces).
- Phase 10 PRD (this repo) — R10.9 authority nuance; R10.10 SSH remote; F10-S7 verification items (feed G1).
- Phase 11 PRD (this repo) — `snapshot-sync.sh` behavior + D9 runbook (feed G3 loop).
- Phase 9 PRD (this repo) — R9.4 CLAUDE.md nuance (feed the G4 doc-update task).
- `docs/lab/decisions/log.jsonl` — `d-2026-07-20` (safety rule; `install.sh` disabled; `orchestrating-delivery-agents` global-authoritative), `d-2026-08-09-001` (TouchID pause).
- `CLAUDE.md` — "Skill source of truth" section (will be updated post-G4 per R12.8).
- `~/.claude/CLAUDE.md` — English artifacts rule.

---

*End of Phase 12 PRD.*
