# GSL-231 — permissions inventory + draft `permissions.allow` (read-only)

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/231.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Read-only audit of what the fleet actually calls, cross-referenced against the current `.claude/settings.json` `permissions.allow` block. The seat change (removing `--dangerously-skip-permissions`) remains the owner's call — this task prepares material and nothing more.

Report: `docs/reports/permissions-inventory-2026-08-17/README.md`.

Findings:
- Current allow-list ships 43 Bash-verb entries (audit's "no permissions block" claim is out of date — the block was added by owner directive 2026-08-16, still under the bypass).
- MCP write tools (`mcp__atlassian__transitionJiraIssue` et al) have no entry at all; 550 recorded calls in the 10-day window all happened under the bypass.
- Draft block (section 4 of the report) is verbatim-additive: every current Bash entry preserved, 9 MCP tools added (4 observed writes + 5 read tools), no `--dangerously-skip-permissions` removed here.
- Explicit exclusions from the draft: `launchctl`, `security`, `./install.sh` (guard-disabled), `mcp__atlassian__delete*`, `WebFetch`/`WebSearch`.

## Files touched

- `docs/reports/permissions-inventory-2026-08-17/README.md` — the audit report itself.

`.claude/settings.json` is deliberately NOT touched. The report ends with the verification command; the commit that lands this file changes 0 settings-file lines.

## Verification

- `git diff --name-only HEAD~1..HEAD -- .claude/ apps/core/plist/ | wc -l` → 0 (report verified against its own discipline).
- Bash-verb frequency data mined from `jq -r '.data.cmd' docs/lab/events/2026-08-*.jsonl` (five verbs only; the hook layer under-reports).
- MCP tool frequency from `jq -r '.data.tool' docs/lab/events/2026-08-*.jsonl | sort | uniq -c`.

## Notes / decisions

- The report explicitly names the five-VERB gap in `lab-log.sh` — a follow-up under GSL-232 or GSL-180 could sample-log Bash verbs so a future inventory doesn't have to extrapolate.
- No `deny` block was proposed. GSL-228's tier-2 hard floor already enforces the manifest §3 denylist at the question-emit door; a `deny` here would be redundant with a better-placed guard.
