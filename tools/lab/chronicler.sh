#!/usr/bin/env bash
# =============================================================================
# gosleep lab — chronicler: the T3 regenerator.
# (GSL-86; PRD Phase 4 R4.4 / F4-S2 / F4-S3 / F4-S4; C1, C3, C5, C6-cheap, C8.)
#
# Reads the machine-first tiers and REGENERATES every derived surface:
#
#   docs/lab/events/*.jsonl    (T1 — hooks, 0 tokens)   -.
#   docs/lab/questions/*.jsonl (queue, folded by lab-emit) |->  docs/lab/status.json  (machine)
#   docs/lab/decisions/log.jsonl                           |    docs/lab/site/*.html  (owner, file://)
#   git / gh / heartbeat / ORCHESTRATION-STATE            -'    docs/lab/digest/*.md  (owner, phone)
#
# THREE THINGS THIS IS NOT:
#
#   1. NOT a live pane agent (C5). A bounded job: no pane, no spawn slot, no seat in the fleet of
#      three. The invariant is grep-checkable, and smoke.sh checks it:
#          grep -Ei 'tmux|spawn|Agent tool' tools/lab/chronicler.py   ->   no hits.
#      It runs at a cycle boundary / debounced / on demand, and it exits.
#   2. NOT LLM-driven (C3 + F4-S3). Every artifact -- status.json, the whole dashboard, all seven
#      digest sections -- is built by deterministic code from files on disk. `claude -p` is OPTIONAL
#      glue (--narrate) that adds ONE prose paragraph under --max-budget-usd with an EMPTY
#      --allowedTools. Missing, over budget, or killed: the artifacts are still complete and the page
#      says the narrator was unavailable. A dashboard that exists only when an LLM cooperates fails
#      F4-S3 on its first bad night.
#   3. NOT a writer of events. It reads the timeline and never appends to it (no recursion; the log
#      records what the fleet did, not what the chronicler thought about it). The one exception is
#      delegated: the poll-fill pass (GSL-87), whose lines are provenance-tagged src="poll-fill".
#
# STALENESS IS THE PRODUCT (F4-S3). Every page carries generated_at + max event age and grades itself
# fresh / stale / dead. If the chronicler dies, delivery does not stop -- the pages simply age, and
# they SAY so. A hub that hides its own rot is the tasty-lunch wiki (blueprint 05 section 1.4-1).
#
# WHY THE PYTHON LIVES IN chronicler.py AND NOT IN A HEREDOC HERE (do not "tidy" this away):
#   macOS ships bash 3.2, whose parser for $( ... ) is NOT heredoc-aware: it counts backticks and
#   quotes INSIDE a quoted heredoc. An odd number of backticks in the embedded program -- e.g. one
#   more `word` in a docstring -- makes bash hunt for a closing backtick to EOF and die with
#   "unexpected EOF while looking for matching '`'". It bit this very script at 33 backticks.
#   A syntax error in a hook script means exit 2, and exit 2 in the hook protocol means BLOCK THE
#   OPERATION -- that is how a broken lab script froze every Write/Edit in a live session (GSL-83).
#   So: no embedded program, no counting game. The wrapper stays trivially correct.
#
# Usage:
#   tools/lab/chronicler.sh                     # regenerate everything for today (UTC)
#   tools/lab/chronicler.sh --date 2026-07-12   # ...for a given day (the digest is per-day)
#   tools/lab/chronicler.sh --narrate           # ...+ the bounded claude -p prose paragraph
#   tools/lab/chronicler.sh --dry-run --json    # ...plan only: write nothing, print the report
#
# Flags:
#   --repo PATH            repo root (default: this script's ../..)
#   --date YYYY-MM-DD      target day for digest/timeline (default: today, UTC)
#   --narrate|--no-narrate bounded claude -p prose in the digest (default: off -- opt-in)
#   --max-budget-usd N     hard cap for the narrator      (default: 0.25)
#   --model M              narrator model, cheap tier     (default: claude-haiku-4-5-20251001)
#   --prune|--no-prune     apply events retention         (default: prune, 30d per docs/lab/README.md)
#   --retention-days N     override the 30-day window
#   --compact-queue        also rewrite queue.jsonl without archived records (default: archive only)
#   --no-poll              skip the poll-fill reconcile pass (GSL-87)
#   --dry-run              compute everything, write nothing
#   --json                 print the run report as JSON
#   --quiet                errors only
#
# Exit: 0 even when a source is unavailable (gh offline, no claude, no heartbeat) -- degraded, never
# fatal, and every degradation is DATA: it lands in status.json, on the page, and in the digest.
# Non-zero only on a genuine internal error -- and even then the OLD artifacts survive intact, because
# lab-write.sh is atomic: a reader sees the entire old file or the entire new one, never a prefix.
#
# 0 API keys (C1 -- grep confirms: none here; claude -p rides the subscription). python3 stdlib only.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CHRONICLER_REPO_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec python3 "$SCRIPT_DIR/chronicler.py" "$@"
