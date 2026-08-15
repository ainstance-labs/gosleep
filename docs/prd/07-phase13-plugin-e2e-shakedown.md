# PRD — Phase 13: E2E plugin shakedown runs

> **Status:** Draft — 2026-08-15 (per-phase file; near-term half of the plugin-migration program)
> **Owner:** Roman L (rommxx@gmail.com) · **Project:** GSL (GoSleep) · **Program epic:** [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337)
> **Design source of truth:** `docs/reports/plugin-migration-research-2026-08-15/strategy.md` sections 3C (v1 skills-only; v2 candidates named for later) + section 4A Phase 2 observation criteria + section 6 risks 5, 7 (agent shadowing, cache/discovery staleness).
> **Language rule:** English artifact per `~/.claude/CLAUDE.md` (2026-08-07).
> **Report convention** (owner memory `web-verification-html-runs.md`, 2026-08-10): готовность подтверждается функциональными циклами верификации, на каждый run — свой HTML-отчёт EN+RU со скринами и описанием на каждом шаге; memory `verification-report-runs-format.md` locks the runs directory shape as `docs/reports/verifications/GSL-337/runs/NN/index.html`.

---

## Positioning: prove the plugin loop end-to-end with a real dev-agent task, per run

Every prior phase in the near-term program is a mechanism check (Phase 9 = data present; Phase 10 = artefact valid; Phase 11 = release loop mechanical; Phase 12 = install / stub / trial / archive gates land safely). None of them, by construction, proves the whole loop from *"a dev-agent spawns, sees plugin-namespaced skills, uses one to ship a small piece of work, verifier-skeptic audits it, agentic-report-creator renders the audit dashboard"* — the actual daily-work flow the migration exists to preserve.

Phase 13 is the shakedown for exactly that: a bounded, adversarially-verified sequence of E2E runs where a dev-agent, launched into a sandboxed workspace with `ainstance-labs/gosleep-plugins` loaded (or side-loaded via `--plugin-dir`), builds a small React task through the gosleep harness. Every run yields an HTML report (EN + RU per memory) with per-step screenshots + a short narrative, filed under `docs/reports/verifications/GSL-337/runs/NN/index.html`. A second adversarial worker independently re-reads the report + repro'd the transcript to try to refute the claim of success.

**Sandboxed workspace, not the shared tree.** The E2E runs never mutate the main `GSL-174-skills-management` worktree, never write `~/.claude/**` beyond what Claude Code writes itself (session state, cache), and never install/uninstall plugins mid-run. The `--plugin-dir` sideload path (proven by Phase 10 F10-S5) OR a dedicated pilot user-scope install (Phase 12 G1) is the delivery vector; each run states which.

---

## Goal

At least three E2E runs land under `docs/reports/verifications/GSL-337/runs/`, each covering a distinct dev-agent task scenario, each with a self-contained HTML report (EN + RU, per-step screenshots, adversarial-verification section) proving:

- The dev-agent, in the sandboxed workspace, discovers the plugin-namespaced skills (`gosleep-delivery:handoff`, `gosleep-orchestration:remote-control`, `gosleep-evals:verifier-skeptic`, `gosleep-evals:agentic-report-creator`) alongside any loose skills that remain.
- The dev-agent uses at least one plugin-namespaced skill to actually ship a small piece of React work (build a minimal component, wire a tiny API call, or edit an existing surface) — the plugin skill is not just discovered, it is *invoked*.
- The verifier-skeptic loop runs plugin-namespaced (`gosleep-evals:verifier-skeptic`) against the dev-agent's shipped work and produces a findings payload.
- The agentic-report-creator loop, plugin-namespaced (`gosleep-evals:agentic-report-creator`), renders the run's HTML dashboard from that payload.
- No lifted rail: agents did not write `~/.claude/**`; agents did not run `claude plugin install/update`; the loose global skills stayed byte-untouched during the run (F13-S3 below).

The adversarial verifier for each run is a **second, independent worker** that re-reads the report + optionally re-launches the transcript and tries to refute the success claim (findings-file in `docs/reports/verifications/GSL-337/runs/NN/skeptic.md`, minimally). Any refuted-and-real defect files a follow-on ticket; the phase does not end silently.

---

## Scope

| In | Out (and why) |
|---|---|
| **Sandboxed workspace setup** — a fresh checkout at `/tmp/gsl-337-e2e-run-<NN>/` (or equivalent isolated path), branch off `origin/main`, minimal React scaffold (either an existing test app in the repo or a fresh Vite bootstrap the run creates as its first commit). | Any mutation of the shared `GSL-174-skills-management` worktree. |
| **Plugin delivery vector — one of two options per run.** (a) `--plugin-dir <plugins-repo>/gosleep-*` sideload (matches Phase 10 F10-S5). (b) Pilot user-scope install (Phase 12 G1) if G1 has landed at execution time. Each run's report states which vector. | Owner-scope install from within the E2E run — Phase 12 G1 owns that action; a run may READ an installed set but does not INSTALL. |
| **Three or more distinct dev-agent task scenarios** — examples: (i) build a small React component + `verifier-skeptic` audits + `agentic-report-creator` renders the run report; (ii) `handoff` + `writing-prds` chain — the dev-agent writes a mini-PRD then a handoff, with the plugin skills orchestrating; (iii) `orchestrating-delivery-agents` + `tmux-agents-orchestration` — a small orchestrator spawns one worker, both agents using plugin-namespaced skills. Owner may substitute scenarios at execution time. | An exhaustive test-suite — three well-chosen scenarios cover discovery + invocation + verifier + report + orchestration; more is welcome, not required. |
| **Per-step screenshots** in each report — the browser view of the running React app at each meaningful step, plus terminal/transcript excerpts for the plugin-skill invocations. Rendered inline in the HTML dashboard's lightbox (per `agentic-report-creator` capabilities). | Video capture — HTML+screenshots per step is the format memory `web-verification-html-runs.md` locks in. |
| **HTML report per run (EN + RU)** — filed at `docs/reports/verifications/GSL-337/runs/NN/index.html` (NN starts at 01, monotonic per run). English primary, Russian shell (per `agentic-report-creator` skill). Zero external deps; opens offline from `file://`. | A single aggregated report across all runs — one HTML per run per convention; a rollup summary is a nice-to-have, not required. |
| **Adversarial verification per run** — a second worker (spawned as an independent Agent invocation, no shared context) re-reads the run's report + evidence and tries to refute the success claim. Findings land at `docs/reports/verifications/GSL-337/runs/NN/skeptic.md`. Any refuted-and-real defect files a follow-on Jira ticket (labeled `verifier`, per verifier-skeptic conventions). | An automated regression suite (e.g. `plugin eval` hooked into CI). `plugin eval` is a Phase 13 follow-on candidate; adversarial-human-review is the primary shakedown mechanism for the initial pass. |
| **Coexistence proof per run** — the run's HTML shows both `handoff` (loose) and `gosleep-delivery:handoff` (plugin) resolving in the same session's `/skills` output (or equivalent skill listing surface). | A cutover — Phase 13 explicitly does NOT flip any invocation to plugin-only; the coexistence proof is the point. |
| **Cache/discovery staleness handling** — each run's report documents the launch sequence: fresh session start OR `/reload-plugins` used, and whether skills were discoverable on first `/skills` invocation. Documents the "update → restart → verify" cadence in the same shape as the Phase 11 D9 runbook. | Debugging plugin-loader internals — surface behavior only. |

---

## Success criteria

- **F13-S1 (three runs land).** `ls docs/reports/verifications/GSL-337/runs/` shows at least three run directories (`01/`, `02/`, `03/`), each containing `index.html`, a `screenshots/` subdir, a `skeptic.md`, and the raw transcript / findings artefacts.
- **F13-S2 (plugin invocation, not just discovery).** Each run's report evidences at least one plugin-namespaced skill invocation that materially produced work — a call transcript showing the plugin skill's frontmatter surface (not a copy of a loose skill), plus the resulting artefact (a React file, a PRD, a handoff, a verifier findings JSON — whatever the scenario shipped). Discovery-only is not enough.
- **F13-S3 (rails held).** Per run, the report includes a "Rails" section documenting: (a) `~/.claude/**` untouched (`stat` output pre/post); (b) no `claude plugin install/update/marketplace add` inside the run; (c) loose global SKILL.md sha256 unchanged before/after (except intentionally by Phase 12 G2 stubs if the run happened post-G2 — the run notes which state).
- **F13-S4 (adversarial pass done).** Per run, `skeptic.md` exists, names the second worker's agent id / spawn context, lists at least three attempted refutations (each with a verdict: refuted / plausible / confirmed), and — if any confirmed real defect surfaces — links a filed follow-on ticket. An empty skeptic file with "nothing to refute" is a defect: at least three attempted refutations MUST be enumerated even if all are refuted.
- **F13-S5 (report format).** Each `index.html` is self-contained (no external CDN, no font/CSS remote fetch), opens offline from `file://`, ships light + dark themes, English primary + Russian translation shell, and has a keyboard-navigable screenshot lightbox — per `agentic-report-creator` skill contract.
- **F13-S6 (coexistence proof).** Each run's report has a screenshot / transcript excerpt showing both name forms resolving in the same session for at least one skill (e.g. `handoff` and `gosleep-delivery:handoff`).
- **F13-S7 (D9 discipline held during shakedown).** No mid-shift `claude plugin update` during any run. Any release cut during the shakedown window (Phase 11 `snapshot-sync.sh`) is applied at a shift boundary between runs, with dev_history entries.
- **F13-S8 (follow-on issues filed).** Any refuted-and-real defect the adversarial pass surfaces becomes a filed Jira Task labeled `verifier` (per `verifier-skeptic` skill convention). If zero defects surface, the shakedown ends with a clean-verdict summary that names the exact scope covered — no silent "all good."

---

## Requirements

- **R13.1 — Sandboxed workspace at execution time.** Every run happens in a fresh checkout under `/tmp/` or `data/tmp/` (`data/` is git-ignored per CLAUDE.md), never in the shared main worktree. Acceptance: report evidences the workspace path.
- **R13.2 — Plugin delivery vector recorded.** Each run states in the report whether it used `--plugin-dir` sideload (Phase 10 F10-S5 mechanism) or a G1 pilot install (Phase 12). If G1 has landed at execution time, prefer the G1 vector as it is closer to the target end-state. Acceptance: report evidences the vector.
- **R13.3 — Plugin skills are INVOKED, not just DISCOVERED.** Per run, at least one plugin-namespaced skill is called with intent and produces an artefact captured in the report. A run whose sole plugin evidence is "the skill appeared in `/skills` output" fails F13-S2. Acceptance: F13-S2.
- **R13.4 — Coexistence is proven per run.** Per run, both name forms (bare + `plugin-name:skill-name`) resolve in the same session for at least one skill. Acceptance: F13-S6.
- **R13.5 — Rails are actively verified, not assumed.** Each run's "Rails" section includes explicit pre/post checks for `~/.claude/**` mtimes, no `claude plugin install/update/marketplace add` invocations, and loose global SKILL.md checksums unchanged (baseline captured at run start; delta captured at run end). Acceptance: F13-S3.
- **R13.6 — Adversarial pass is independent.** The second worker spawned for skeptic.md carries no in-context knowledge of the first worker's transcript beyond what the report + raw artefacts publish. Any pre-brief must be reproduced in the skeptic.md itself so the audit is traceable. Acceptance: F13-S4 (the skeptic file names the spawn context).
- **R13.7 — Report format per convention.** `agentic-report-creator` skill contract satisfied: self-contained HTML, EN + RU, per-step screenshots via lightbox, integer-numbered items each naming a Jira ticket where applicable, no external deps. Acceptance: F13-S5.
- **R13.8 — D9 discipline preserved during shakedown.** No mid-shift `claude plugin update`. Any release cadence exercised during Phase 13 uses shift boundaries; dev_history logs each. Acceptance: F13-S7.
- **R13.9 — Follow-on defects filed.** Any real defect surfaced by the adversarial pass becomes a Jira Task with a link back to the run + the specific skeptic finding. Zero-defect result is stated explicitly, never implicit. Acceptance: F13-S8.
- **R13.10 — Runs directory layout.** `docs/reports/verifications/GSL-337/runs/NN/index.html` per memory `verification-report-runs-format.md`. `NN` is zero-padded, monotonic, starting `01`. Each run directory holds its own `screenshots/`, `skeptic.md`, and raw artefacts. Acceptance: F13-S1.

---

## Tasks (parent epic `[Docs][Skill] Plugin migration PRD (near-term program)`, GSL-337; execution ticket to be filed separately when Phase 13 build begins)

Reproduced here so the future execution epic has a target list.

1. `[Docs][Process]` — write the shakedown-run playbook: sandbox setup, delivery-vector choice, scenario list, rails-check script, skeptic-worker spawn template, report file paths.
2. `[Web][Skill]` (per run) — execute run 01: sandboxed React scaffold + one plugin-namespaced skill invocation shipping small work; verifier-skeptic loop; agentic-report-creator renders `runs/01/index.html`.
3. `[Web][Skill]` (per run) — execute runs 02 and 03 with distinct scenarios (see In-scope table for candidates).
4. `[Docs][Skill]` (per run) — adversarial pass: spawn independent worker; produce `runs/NN/skeptic.md` with at least three attempted refutations; file follow-on tickets on confirmed defects.
5. `[Docs][Process]` — shakedown-close summary: dev_history entry linking all three runs, aggregated verdict, whether Phase 12 G3 can proceed based on shakedown evidence (feeds Phase 12 G3 kickoff).

---

## Dependencies

- Phase 10 (bundles v0.1.0 in the plugins repo). Runs sideload from those bundles.
- Phase 9 (orphan rescue). `gosleep-evals` bundle includes `verifier-skeptic` and `agentic-report-creator`, both from the rescued orphans; both are load-bearing for R13.3 + R13.7.
- Optionally, Phase 12 G1 landed (three bundles installed at user scope). If yes, runs use the G1 vector; if no, runs use `--plugin-dir` sideload.
- `agentic-report-creator` skill contract (rendered HTML aesthetic, EN + RU, screenshots lightbox, offline-openable) — R13.7.
- `verifier-skeptic` skill contract (adversarial three-lane audit, findings as numbered Jira tasks labeled `verifier`) — R13.9.
- Memory `web-verification-html-runs.md` (2026-08-10) + memory `verification-report-runs-format.md` (2026-07-23) — the report format + runs directory shape.

---

## Non-goals (explicit)

- Any `claude plugin install/update/marketplace add` invocation inside a run.
- Any mutation of the shared `GSL-174-skills-management` worktree.
- A CI-integrated regression suite (`claude plugin eval` hookup is a candidate follow-on; Phase 13 is human adversarial).
- Cutover — every run proves coexistence; nothing here flips invocation to plugin-only.
- Multi-machine runs — a Phase 13 run is single-machine on the owner's laptop.
- Any write to `~/.claude/**`.
- Any bypass of the D9 update discipline for the sake of a run (e.g. "install a hotfix mid-run"). If a run needs a release cadence tweak, it waits for a shift boundary.

---

## Risks + open questions

- Risk 1 — sandbox contamination (the run touches the shared worktree accidentally). Mitigation: R13.1; sandbox path is `/tmp/` or `data/tmp/`; the report's rails check verifies via `pwd` + a `git rev-parse --show-toplevel` capture.
- Risk 2 — cache/discovery staleness (`/skills` shows the plugin skill only after `/reload-plugins` or a session restart). Mitigation: strategy section 6 risk 7; the report's launch-sequence section documents whichever cadence worked and the update-runbook (Phase 11) is updated with the concrete cadence.
- Risk 3 — agent shadowing (strategy section 6 risk 5) if a scenario ships a `.claude/agents/` file inside the sandbox. Mitigation: R13.3 keys on skill invocations (which coexist symmetrically per strategy section 1.4), not agent invocations; sandbox setup avoids adding a `.claude/agents/` file unless the scenario explicitly exercises the shadowing behavior.
- Risk 4 — the adversarial pass becomes a rubber stamp ("nothing to refute — passed"). Mitigation: R13.6; F13-S4 requires at least three attempted refutations enumerated; the adversarial worker's system prompt (from the `verifier-skeptic` skill) is adversarial by construction.
- Risk 5 — one of the scenarios cannot ship a real React artefact under a shakedown time budget. Mitigation: scenario (i) is deliberately minimal (build a small component); scenario (ii) has no React requirement (`handoff` + `writing-prds` chain); scenario (iii) exercises the orchestrator patterns. If a scenario stalls, substitute it — three distinct scenarios is the acceptance shape, not three specific scenarios.
- Risk 6 — RU translation shell falls out of sync with EN primary in a report. Mitigation: `agentic-report-creator` skill enforces the shell shape; report reviewer checks parity as a Q-line in the shakedown-close summary.

Open questions (recommended defaults for the execution ticket):

- Q1. Delivery vector for the first run? → **default:** `--plugin-dir` sideload (Phase 10 F10-S5 mechanism) if G1 has not landed; else G1 user-scope install.
- Q2. Number of runs? → **default:** three; owner may extend if evidence quality is weak.
- Q3. Do the runs count toward Phase 12 G3 trial? → **default:** yes — they exercise the plugin invocation path; every run in Phase 13 is a lightweight preview of the G3 experience.
- Q4. Scenario mix? → **default:** the three above; owner may substitute; the acceptance is diversity across discovery / invocation / orchestration.
- Q5. `plugin eval` follow-on? → **default:** defer to a v2 follow-on; not part of the initial shakedown.

---

## Sources

- `docs/reports/plugin-migration-research-2026-08-15/strategy.md` — sections 1.4 (coexistence), 3C (v1 skills-only + v2 candidates), 4A Phase 2 observation criteria, section 6 risks 5-7-9.
- `docs/reports/plugin-migration-research-2026-08-15/findings/current-state-and-fit.md` — sections 1.5 (`verifier-skeptic` + `agentic-report-creator` provenance).
- Phase 9 PRD (this repo) — rescued the two skills the shakedown loop uses.
- Phase 10 PRD (this repo) — F10-S5 sideload smoke mechanism.
- Phase 11 PRD (this repo) — D9 update discipline (shakedown holds it).
- Phase 12 PRD (this repo) — G1 optional delivery vector; shakedown feeds G3 kickoff.
- Memory `web-verification-html-runs.md` (2026-08-10) — HTML report + per-step screenshots per run.
- Memory `verification-report-runs-format.md` (2026-07-23) — `runs/NN/` shape.
- `agentic-report-creator` skill contract — HTML dashboard EN + RU, offline-openable, lightbox.
- `verifier-skeptic` skill contract — adversarial three-lane audit, `verifier`-labeled Jira tasks.

---

*End of Phase 13 PRD.*
