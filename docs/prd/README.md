# PRD index — GoSleep

| File | Type | Status | One-liner |
|---|---|---|---|
| [`PRD-gosleep-evolution.md`](./PRD-gosleep-evolution.md) | Initiative (Phases 1-6, historical monolith) | Draft — 2026-07-08 | "Orchestrator that lets the owner sleep": watchdog → self-pulse/night → question-buffer/manifest/digest → laboratory → UI → mobile. Phases 1-6 retained in Russian as archive. |
| [`01-phase7-interactive-control-plane.md`](./01-phase7-interactive-control-plane.md) | Per-phase PRD (Phase 7) | Draft — 2026-08-07 | Live web control plane at `http://127.0.0.1:7331` (SQLite = source of truth, gosleep-core on Bun+Hono, React+Vite+shadcn client). Supersedes Phase 5 (owner decision `d-2026-08-03-004`). Epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250). |
| *[`02-phase8-skills-management.md`](./02-phase8-skills-management.md)* | Per-phase PRD (Phase 8) — **lands via PR #307 (branch `GSL-174-skills-management`)**; not present on `origin/main` at the time this README was updated. | Draft — 2026-08-10 | Skills management system: development in `skill/<name>/`, publish by owner via one button; four-layer defense. Epic [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174). |
| [`03-phase9-plugin-orphan-rescue.md`](./03-phase9-plugin-orphan-rescue.md) | Per-phase PRD (Phase 9) | Draft — 2026-08-15 | Plugin migration Phase 0: reverse-sync the 5 owner-authored orphan skills (`agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`, `extra-usage`, `verifier-skeptic`) from `~/.claude/skills/` into `skill/`. Independent of every architecture decision. Executed under epic [GSL-334](https://ainstance-labs.atlassian.net/browse/GSL-334). |
| [`04-phase10-plugin-bundles-v01.md`](./04-phase10-plugin-bundles-v01.md) | Per-phase PRD (Phase 10) | Draft — 2026-08-15 | Plugin migration Phase 1: three v0.1.0 bundles (`gosleep-delivery`, `gosleep-orchestration`, `gosleep-evals`) in the dedicated private repo `ainstance-labs/gosleep-plugins`. `plugin validate --strict` + sideload smoke; nothing installed. Program epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337). |
| [`05-phase11-snapshot-release-pipeline.md`](./05-phase11-snapshot-release-pipeline.md) | Per-phase PRD (Phase 11) | Draft — 2026-08-15 | Plugin migration release loop: `tools/skills/snapshot-sync.sh` — owner-gated sync-then-bump-then-tag; CHANGELOG.jsonl schema extended additively with a `kind` field (D6); D9 update discipline in a new runbook. Program epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337). |
| [`06-phase12-plugin-global-scope-transition.md`](./06-phase12-plugin-global-scope-transition.md) | Per-phase PRD (Phase 12) | Draft — 2026-08-15 | Plugin migration G1-G4 (owner-refined 2026-08-15): parallel install → the ONE sanctioned near-term write (deprecation stubs) → ~1-month trial → owner archive-move. Lightweight owner-only workflow flip; distinct from far-future 4B ceremony. Program epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337). |
| [`07-phase13-plugin-e2e-shakedown.md`](./07-phase13-plugin-e2e-shakedown.md) | Per-phase PRD (Phase 13) | Draft — 2026-08-15 | Plugin migration E2E shakedown: three-plus sandboxed dev-agent runs, one HTML report (EN + RU) per run under `docs/reports/verifications/GSL-337/runs/NN/`, adversarial verification per run. Program epic [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337). |

## Convention — per-phase PRD files (owner rule, 2026-08-07)

All new PRD phases from Phase 7 onward are written as **standalone per-phase files**, named
`<NN>-phase<MM>-<slug>.md`, in **English only**. The parent `PRD-gosleep-evolution.md` monolith
carries a short English pointer at the location where the phase used to be appended. Legacy
phases 1-6 stay in the monolith as a historical Russian archive and are not translated
retroactively — but every new PRD artefact is English by construction.

## Global traceability — plugin-migration program (Phases 9-13)

Source of truth: `docs/reports/plugin-migration-research-2026-08-15/strategy.md` (final as of
2026-08-15; owner decisions D3 = dedicated private repo, D4 = `gosleep-plugins`,
G1-G4 sub-plan, ~1-month trial, archive-move; section 3C v1 skills-only + v2 candidates named).
Every near-term requirement in the strategy is mapped to a destination phase below; the
right-hand column names the acceptance-ID inside the phase file. Far-future 4B (F1 / F2 / F3)
requirements are explicitly **out of scope** here — the strategy holds the record.

| Strategy source (section — requirement) | Destination phase | Acceptance-ID |
|---|---|---|
| Executive summary → Recommended near-term path (1) — rescue the 5 orphans | Phase 9 | F9-S1, F9-S2, F9-S3, F9-S4, F9-S5 |
| Section 2.1 — `orchestrating-delivery-agents` byte-equal to global (GSL-251) | Phase 9 dependency (already landed 2026-08-10); no new work | (input to Phase 10 R10.5) |
| Section 3A.1 — three thematic bundles (D1 = option B, D2 recommended composition) | Phase 10 | F10-S1, F10-S2, F10-S3, R10.2 |
| Section 3A.2 — dedicated private repo `ainstance-labs/gosleep-plugins` (D3, D4 decided) | Phase 10 | F10-S1, R10.1, R10.10 |
| Section 3A.2 — layout rules (only `plugin.json` in `.claude-plugin/`; `skills/` at bundle root) | Phase 10 | F10-S4, R10.4 |
| Section 3A.3 — semver in `plugin.json` only, start `0.1.0`, `1.0.0` reserved for F2 (D5) | Phase 10 for `0.1.0`; Phase 11 for bump discipline | F10-S2, F11-S4, R11.4 |
| Section 3A.4 — snapshot-release script pipeline (a-h) | Phase 11 | F11-S1..S8, R11.1..R11.10 |
| Section 3A.4 — CHANGELOG ledger repurpose (release rows + publish rows shared) | Phase 11 (schema extension) | F11-S5, R11.5 |
| Section 3A.4 — honest scope statement (interim ≠ per-edit provenance) | Phase 11 (Positioning + Non-goals) | R11.5, Non-goal "per-edit provenance" |
| Section 3A.6 — D9 update discipline (owner-run, no mid-shift, auto-update suppressed) | Phase 11 (runbook) + Phase 12 (execution) | F11-S8, F12-G1-S2, F12-G3-S3, R11.9, R12.5 |
| Section 3C — v1 bundles skills-only; v2 candidates (MCP / hooks / subagents) named | Phase 10 (skills-only Scope) + Non-goals | Non-goal "hooks / MCP / subagents / commands" |
| Section 4A Phase 0 — Orphan rescue | Phase 9 | (whole file) |
| Section 4A Phase 1 — bundles + pipeline + verification items | Phase 10 (bundles + verification items) + Phase 11 (pipeline) | F10-S1..S7, F11-S1..S8 |
| Section 4A Phase 2 — optional pilot install observation criteria | Phase 12 G1 + Phase 13 shakedown | F12-G1-S1, F13-S1..S8 |
| Section 4A-G G1 — parallel install of 3 bundles at user scope | Phase 12 G1 | F12-G1-S1, F12-G1-S2 |
| Section 4A-G G2 — deprecation stubs (the ONE sanctioned near-term write) | Phase 12 G2 | F12-G2-S1, F12-G2-S2, R12.3 |
| Section 4A-G G3 — ~1-month trial with edits in the plugins repo folder | Phase 12 G3 | F12-G3-S1, F12-G3-S2, F12-G3-S3, R12.4 |
| Section 4A-G G4 — owner archive-move of 12 loose global copies | Phase 12 G4 | F12-G4-S1, F12-G4-S2, R12.7 |
| Section 4A-G boundary line — G4 vs. 4B (lightweight owner-only vs. productized ceremony) | Phase 12 Positioning + Non-goals + R12.9 | R12.9, Non-goal "any 4B step" |
| Section 4B (F1 / F2 / F3) — cross-project cutover, productized ceremony, decommission at scale | **Deferred (out of near-term scope)** — see strategy sections 3B, 4B, D10 | n/a |
| Section 5.1 — web control plane surfaces plugin provenance (sketch) | Phase 11 R11.10 (timeline event fallback); optional Phase 12 badge (non-blocking) | R11.10, Phase 12 In-scope "Skills-screen coexistence view" |
| Section 5.2 — PR #307 components under plugins (near-term column) | Phase 11 (CHANGELOG D6 extension) | F11-S5, R11.5 |
| Section 6 risk 1 — plugin/marketplace name immutability | Phase 10 (Risks) + Non-goal "renaming bundles later" | Risk 1 in Phase 10 |
| Section 6 risk 2 — reserved marketplace names shift | Phase 10 (Risks, F10-S1 re-check) | Risk 2 in Phase 10 |
| Section 6 risk 3 — dual version definition footgun | Phase 10 R10.3 + Phase 11 R11.4 | R10.3, R11.4 |
| Section 6 risk 4 — forgotten version bump | Phase 11 pipeline always bumps | R11.4 |
| Section 6 risk 5 — agent shadowing | Phase 10 (v1 skills-only) + Phase 13 (Risks) | Non-goal "hooks / MCP / subagents" + Risk 3 Phase 13 |
| Section 6 risk 6 — private-repo credential failure | Phase 10 R10.10 (SSH) + Phase 12 (Risks) | R10.10, Risk 5 Phase 12 |
| Section 6 risk 7 — cache/discovery staleness | Phase 13 launch-sequence documentation | Risk 2 Phase 13 |
| Section 6 risk 8 — background auto-update surprising a night shift | Phase 11 D9 runbook + Phase 12 R12.5 | R11.9, R12.5 |
| Section 6 risk 9 — layout mistakes | Phase 10 R10.4 + F10-S4 | R10.4, F10-S4 |
| Section 6 risk 10 — single-skill plugin name fallback | Phase 10 R10.4 (frontmatter `name` preserved) | R10.4 |
| Section 6 risk 11 — snapshot staleness | Phase 11 R11.10 emit + Phase 12 (Risks) | R11.10 |
| Section 6 risk 12 — gstack anti-pattern (`git stash` + `reset --hard`) | Phase 11 R11.6 (atomic release via scratch checkout, never `--hard` on shared tree) | R11.6 |
| Section 6 risk 13 — inventory incompleteness | Phase 9 R9.5 (dev_history records search criteria) | R9.5 |
| Section 7 D1 — packaging granularity | Phase 10 R10.2 | R10.2 |
| Section 7 D2 — bundle composition + naming | Phase 10 R10.2 (with override handling) | R10.2 |
| Section 7 D3 — marketplace home | Phase 10 (Positioning + R10.1) | R10.1 |
| Section 7 D4 — marketplace name `gosleep-plugins` | Phase 10 (Positioning + F10-S1) | F10-S1 |
| Section 7 D5 — versioning rules | Phase 10 R10.3 + Phase 11 R11.4 | R10.3, R11.4 |
| Section 7 D6 — PR #307 fate + CHANGELOG shared ledger | Phase 11 R11.5 | R11.5 |
| Section 7 D7 — `orchestrating-delivery-agents` authority regime | Phase 12 R12.6 (per-skill G3 go/no-go) | R12.6 |
| Section 7 D8 — Phase 0 scope | Phase 9 Scope + Uncertain-orphan flag | R9.5 |
| Section 7 D9 — update discipline | Phase 11 R11.9 + Phase 12 R12.5 | R11.9, R12.5 |
| Section 7 D10 — evidence bar for 4B | **Deferred (out of near-term scope)** — strategy section 3B / F1-F3 | n/a |

Explicit deferrals — everything under strategy sections 3B and 4B (F1 cross-project cutover;
F2 productized contribution ceremony; F3 legacy decommission at scale) waits on
**gosleep = full PRODUCTION + separate owner decision + D10 evidence** (strategy Owner
corrections point 1; section 4B gate). This near-term program does not schedule or preview
those; the strategy is the record.

## Legacy note — Phases 1-6

Legacy phases 1-6 are consolidated in `PRD-gosleep-evolution.md` (Russian, historical). Their
traceability lives inside that file's own "Сквозная матрица трассируемости" section — not
duplicated here to avoid double-truth.
