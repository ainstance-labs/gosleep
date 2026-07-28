#!/usr/bin/env bash
# =============================================================================
# gosleep lab — poll-fill: reconcile-don't-trust.
# (GSL-87; PRD Phase 4 R4.2, part 2.)
#
# THE PROBLEM IT EXISTS FOR. Hooks (T1) only see what happened THROUGH an agent. A PR merged from the
# web UI, a Jira issue dragged to Done on a phone, a commit the owner made himself -- no agent ran a
# command, so no hook fired, so the timeline never learns about it. And the timeline does not go
# quiet: it goes CONFIDENT. It shows a PR still open, an issue still In Progress. An event log that
# LIES is worse than one that is missing, because the missing one at least sends you to look.
#
# So: after the fact, ask the external sources of truth what really happened, diff that against the
# log, and backfill only the gaps -- provenance-tagged src="poll-fill", never disguised as a hook:
#
#   git log        -> vcs.commit                 (commits from outside any agent session)
#   gh pr list     -> vcs.pr.opened / .merged    (the acceptance case: merged from the web)
#   Jira (see below) -> tracker.issue.transitioned
#
#   src="hook:*"    = observed, mechanically, as it happened  (0 tokens, nobody's cooperation needed)
#   src="poll-fill" = INFERRED afterwards from an external record
# Both are true; they are not the same KIND of true, so they never share a tag. `jq 'select(.src ==
# "poll-fill")'` answers "what did the hooks miss?" -- which is also how you find a broken hook.
#
# IDEMPOTENCE IS THE ACCEPTANCE CRITERION (verbatim from GSL-87): running it twice must add zero
# lines the second time. Dedup is keyed on the EXTERNAL identity of the fact (sha / PR number /
# issue+status), never on seq or timestamp -- so the same commit seen by a hook AND later by git log
# collapses onto one key, and poll-fill never duplicates the fleet's own work.
#
# JIRA NEEDS A FEED. There is no Jira CLI on this machine and we hold no API key (C1 forbids one), so
# the JQL must come from the MCP side. Three feeds, in order:
#     --jira-json FILE                    # [{"key","status","updated","summary"}, …]  (raw Jira REST shape also ok)
#     acli/jira CLI                       # if one is ever installed
#     docs/lab/scratch/jira-poll.json     # GSL-223: the conventional dump the ORCHESTRATOR saves at
#                                         # every cycle boundary (same shapes). Picked up automatically
#                                         # and LOUDLY: the report names the feed and the dump's age.
# If none is present, the Jira source is SKIPPED LOUDLY -- the skip lands in the report, in
# status.json (degraded[]) and on the page. A reconcile that quietly did not run, yet looks like a
# clean one, is the exact failure this task exists to prevent.
#
# TIMESTAMPS. lab-log stamps ts = now (it has no --ts). For a backfilled event that is the honest
# reading: `ts` = when we LEARNED it, `data.occurred_at` = when it HAPPENED. They differ precisely
# because nobody was watching -- which is the whole reason this pass exists.
#
# Usage:
#   tools/lab/poll-fill.sh                       # reconcile the last 7 days, write the gaps
#   tools/lab/poll-fill.sh --dry-run --json      # …show the gaps, write nothing
#   tools/lab/poll-fill.sh --jira-json /tmp/jql.json
#   tools/lab/poll-fill.sh --since-days 30 --no-jira
#
# Runs automatically as step 0 of every chronicler pass (tools/lab/chronicler.sh; --no-poll opts out).
#
# Why the python is a separate file: macOS bash 3.2 does not parse heredocs inside $( ) -- it counts
# backticks INSIDE a quoted heredoc, and an odd count sends it hunting to EOF. A bash syntax error is
# exit 2, and exit 2 in the hook protocol means BLOCK THE OPERATION. See chronicler.sh, same story.
#
# 0 API keys (C1). python3 stdlib only. Writes ONLY through tools/lab/lab-log.sh.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export POLLFILL_REPO_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec python3 "$SCRIPT_DIR/poll-fill.py" "$@"
