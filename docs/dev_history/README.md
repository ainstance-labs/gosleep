# Dev history — index

One file per Jira Task, written right after the task's commit lands. Part 1 of each file is the
plain-language story (what was done, what hurt, where the bodies are buried); Part 2 is the short
technical reference. See `CLAUDE.md` for the convention.

Legacy pre-GSL history (the TLM / tasty-lunch era, numbered `00`–`10`) lives in `docs/dev-history/`
(hyphen) and is kept as imported history — new entries go here.

## Epic GSL-1 — Project initialization

- [GSL-2 — Import orchestration harness v0](GSL-2-init-harness-import.md)
- [GSL-3 — Project anchors: CLAUDE.md, dev_history, README](GSL-3-init-project-anchors.md)
- [GSL-4 — Fix stale pre-move ROOT paths in generators and eval runner](GSL-4-init-root-path-fixes.md)
- [GSL-5 — Skill sync: orchestrating-delivery-agents from global](GSL-5-init-skill-sync.md)

## Epic GSL-7 — Harness hardening

- [GSL-14 — Track orchestration ledger, handoffs & kickoff prompts in git; gitignore .vscode](GSL-14-harden-track-orchestration-artifacts.md)
- [GSL-6 — Require a dated handoff at every orchestrator session boundary (skill)](GSL-6-harden-mandatory-dated-handoff.md)
- [GSL-8 — Recovery: fall back to on-disk handoff FIRST before live probes (skill)](GSL-8-harden-on-disk-handoff-first.md)
- [GSL-9 — Strengthen idempotent find-or-create + reconcile late-arriving IDs (skill)](GSL-9-harden-idempotent-creates-reconcile-ids.md)
- [GSL-10 — On-disk state durability + telemetry recovery across orchestrator rollover (skill)](GSL-10-harden-state-durability-telemetry-recovery.md)
- [GSL-11 — Disambiguate patience vs single active nudge at the PR/finalize boundary (skill)](GSL-11-harden-patience-vs-nudge-pr-boundary.md)
- [GSL-12 — Curb transcript-read exception abuse; tighten context discipline (skill)](GSL-12-harden-context-discipline-transcript-ban.md)
- [GSL-13 — Author E17 / VERIFY-REQUEST / watchdog eval scenarios](GSL-13-harden-eval-scenarios-e17-verify-watchdog.md)

## Epic GSL-15 — Vendoring supporting skills

- [GSL-16 — Restructure skill/ into per-skill subfolders + multi-skill install.sh](GSL-16-vendor-restructure-installsh.md)
- [GSL-17 — Vendor writing-prds, delivery-workflow, handoff, using-jira into the repo](GSL-17-vendor-four-skills.md)
- [GSL-18 — Document the multi-skill layout (CLAUDE.md + skill/README.md)](GSL-18-vendor-docs.md)

## Epic GSL-19 — Eval validation

- [GSL-20 — Make eval-runner efficient: batched judge + per-scenario N + RED baseline cache](GSL-20-eval-runner-efficiency.md)
- [GSL-22 — Run eval agents on cost-appropriate models (Sonnet under-test, Haiku judge)](GSL-22-eval-runner-model-economy.md)
- [GSL-23 — Reliable file-based run-config + hard safety (no silent full-run default)](GSL-23-eval-runner-safe-config.md)
