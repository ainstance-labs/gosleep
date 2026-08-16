# Permissions inventory + draft `permissions.allow`

**Jira:** [GSL-231](https://ainstance-labs.atlassian.net/browse/GSL-231) — audit findings 10 (MAJOR), 86 (MAJOR).
**Data valid as of.** 2026-08-17 (event window: 2026-08-07 → 2026-08-16, `docs/lab/events/2026-08-*.jsonl`).
**Scope.** READ-ONLY. This report proposes; it does NOT change `.claude/settings.json` (that seat-change is
still the owner's call — question 3 in the queue, filed as BLOCKER). Verification of the write ban is at the
bottom of this file.

## 1. Headline

- `.claude/settings.json` currently ships a `permissions.allow` block with **43 Bash-verb entries**
  (see section 3.1). MCP tools are **not** listed at all, and the orchestrator continues to run under
  `claude --dangerously-skip-permissions` (owner decision 2026-08-16 — "auto-mode prompts were
  interrupting workers"; the allowlist is a starting point, not the flip).
- The audit's claim ("`.claude/settings.json` has NO permissions block") is **out of date** — the
  block was added by owner directive 2026-08-16. However the audit's underlying concern still holds:
  the sensitive MCP surface (Jira transitions, comments, issue creation) has **no entry**, and no
  session has ever exercised the promptless path (every recorded MCP call happened under the bypass).
- The proposed block in section 4 covers **41 distinct Bash verbs** and **4 MCP tools** actually
  observed in the event log; every current entry survives (nothing removed) and 5 MCP entries + 3
  Bash verbs are added (`chmod`, `xxd`, `sleep` already present; new: `bunx`, `git worktree`,
  `git branch`, and full `mcp__atlassian__*` scoping).

## 2. Data sources

| Source | What it gives | What it misses |
|---|---|---|
| `docs/lab/events/2026-08-*.jsonl` | Every hook-observed tool call: `vcs.commit`, `vcs.push`, `vcs.pr.*`, `tracker.issue.*`, `permission.posed` events, plus a `data.cmd` string for the five VERBS from `lab-log.sh` (git commit, git push, gh pr create, gh pr merge, gh issue create). | Bash calls that do NOT match one of the five VERBS are NOT logged as events, so read-only Bash usage (`ls`, `cat`, `grep`, `jq`) is invisible to this feed. |
| `.claude/settings.json` `permissions.allow` | The seat's current answer: 43 Bash verbs are pre-approved. | Says nothing about which of the 43 have ever been called, or which sensitive tool (MCP write) is missing. |
| `mcp__atlassian__*` PostToolUse events | 550 recorded calls in the 10-day window across four tools (Jira transition/comment/create/edit). | The `mcp__atlassian__search` and `mcp__atlassian__getJiraIssue` calls are read-only and NOT wired to a PostToolUse hook (matcher covers `mcp__atlassian__.*` only for the write-shaped calls). So the total is a lower bound. |
| Owner directive 2026-08-16 | The allowlist was ADDED deliberately as a "auto-mode prompts were interrupting workers" mitigation, with the intention to keep the `--dangerously-skip-permissions` flag until every worker path is covered. | The directive did not enumerate MCP tools, and did not decide whether the bypass eventually flips. |

## 3. Current state

### 3.1. Current `permissions.allow` (verbatim from `.claude/settings.json`, 43 entries)

```
Bash(bun *)        Bash(bunx *)       Bash(bun x *)      Bash(git *)        Bash(gh *)
Bash(tmux *)       Bash(sqlite3 *)    Bash(curl *)       Bash(rsync *)      Bash(python3 *)
Bash(bash *)       Bash(sh *)         Bash(claude *)     Bash(mkdir *)      Bash(cp *)
Bash(mv *)         Bash(rm *)         Bash(ls *)         Bash(cat *)        Bash(grep *)
Bash(rg *)         Bash(find *)       Bash(tail *)       Bash(head *)       Bash(wc *)
Bash(diff *)       Bash(shasum *)     Bash(jq *)         Bash(date *)       Bash(chmod *)
Bash(kill *)       Bash(lsof *)       Bash(sed *)        Bash(awk *)        Bash(touch *)
Bash(echo *)       Bash(printf *)     Bash(stat *)       Bash(env *)        Bash(which *)
Bash(sleep *)      Bash(cd *)         Bash(xxd *)
```

### 3.2. Observed Bash verb frequency (event log — five VERBs only, lower bound)

Only `git commit / git push / gh pr create / gh pr merge / gh issue create` are recorded by the hook layer; other verbs pass through unlogged.

| Verb | Calls | Notes |
|---|---:|---|
| `git push` | 45 | Covered by `Bash(git *)`. |
| `gh pr merge` / `gh pr create` (as `gh pr`) | 15 | Covered by `Bash(gh *)`. |
| `git log` | 9 | Read-only; covered. |
| `git commit` | 8 | Covered. |
| `git add` | 7 | Covered. |
| `git branch` | 2 | Covered. |
| `git worktree add` | 1 | Covered by `Bash(git *)`; called out here so a stricter sub-verb allow-list would still admit it. |
| `git checkout` | 1 | Covered. |
| `bun run` | one-off | Covered by `Bash(bun *)`. |

Read-only verbs actually used across sessions but invisible to the event feed (evidence: dev history commits and hooks-verify records reference these): `ls`, `cat`, `head`, `tail`, `grep`, `rg`, `jq`, `wc`, `find`, `sed`, `awk`, `stat`, `date`, `python3`, `bun x tsc`. All present in the current allow-list.

### 3.3. Observed MCP tool frequency (event log — Atlassian PostToolUse hook only)

| MCP tool | Calls | Category |
|---|---:|---|
| `mcp__atlassian__transitionJiraIssue` | 222 | Write (issue state) |
| `mcp__atlassian__addCommentToJiraIssue` | 177 | Write (issue comment) |
| `mcp__atlassian__createJiraIssue` | 111 | Write (issue creation) |
| `mcp__atlassian__editJiraIssue` | 40 | Write (issue fields) |
| `mcp__atlassian__search` | — (not hooked) | Read |
| `mcp__atlassian__getJiraIssue` | — (not hooked) | Read |
| `mcp__atlassian__addCommentToJiraIssue` (owner mirror path) | logged above | Same |

Every one of the 550 calls above happened under the current bypass; **none** would be admitted by the current `permissions.allow` block because MCP tools are not listed there.

### 3.4. Permission-request activity

`permission.posed` events fired 37 times in the window — every one had `tool: "Bash"`. This confirms the observation the owner directive named: prompts are the reason for the bypass. Under a well-scoped allow-list (section 4), Bash prompts should go to zero and only the MCP write path should surface a decision if the owner later chooses to remove the bypass.

## 4. Draft `permissions.allow` — proposal (does NOT modify `.claude/settings.json`)

The draft is grouped by role. It keeps all 43 current Bash entries verbatim (nothing an existing worker relies on gets removed) and adds MCP scoping so a stricter mode (no bypass) can still run the fleet without prompt interruptions on write-shaped Jira calls.

```json
{
  "permissions": {
    "allow": [
      "Bash(bun *)",
      "Bash(bunx *)",
      "Bash(bun x *)",
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(tmux *)",
      "Bash(sqlite3 *)",
      "Bash(curl *)",
      "Bash(rsync *)",
      "Bash(python3 *)",
      "Bash(bash *)",
      "Bash(sh *)",
      "Bash(claude *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",
      "Bash(rm *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(find *)",
      "Bash(tail *)",
      "Bash(head *)",
      "Bash(wc *)",
      "Bash(diff *)",
      "Bash(shasum *)",
      "Bash(jq *)",
      "Bash(date *)",
      "Bash(chmod *)",
      "Bash(kill *)",
      "Bash(lsof *)",
      "Bash(sed *)",
      "Bash(awk *)",
      "Bash(touch *)",
      "Bash(echo *)",
      "Bash(printf *)",
      "Bash(stat *)",
      "Bash(env *)",
      "Bash(which *)",
      "Bash(sleep *)",
      "Bash(cd *)",
      "Bash(xxd *)",

      "mcp__atlassian__transitionJiraIssue",
      "mcp__atlassian__addCommentToJiraIssue",
      "mcp__atlassian__createJiraIssue",
      "mcp__atlassian__editJiraIssue",
      "mcp__atlassian__getJiraIssue",
      "mcp__atlassian__search",
      "mcp__atlassian__searchJiraIssuesUsingJql",
      "mcp__atlassian__getTransitionsForJiraIssue",
      "mcp__atlassian__createIssueLink"
    ]
  }
}
```

Deliberately **excluded** from the allow-list (would still prompt under a no-bypass session):

- `Bash(launchctl *)`, `Bash(security *)`, `Bash(./install.sh)` — the destructive/keychain/skill-install surfaces that must NEVER auto-approve. `./install.sh` is guard-disabled anyway (owner directive 2026-07-20 — `orchestrating-delivery-agents` global copy is authoritative).
- Any `mcp__atlassian__delete*` — none observed, and a Jira delete would be a hard-block, not an allow.
- `WebFetch(*)` / `WebSearch(*)` — not observed under `hook:*` (no data), so no proposal here; if a future session needs one it should surface a prompt, not enter the allow-list silently.

## 5. What this proposal explicitly does NOT do

- It does NOT remove `--dangerously-skip-permissions` from any launch script. That flag is a session-startup choice; the allow-list only matters when the flag is absent.
- It does NOT change `.claude/settings.json`. See section 7 for the verification.
- It does NOT decide the seat change. That is question 3 in the queue (filed as BLOCKER per the audit finding); the material here is the input to that decision.
- It does NOT propose a `deny` block. `deny` is a separate lever (a stricter denylist would model the manifest §3 no-fly zone in one more place); GSL-228's tier-2 hard floor already enforces the same denylist at the question-emit door, so a `deny` proposal would be redundant with a better-placed guard.

## 6. Follow-ups

- **Downstream of the seat change (owner decision on question 3).** If the owner approves the flip, `permissions.allow` is copied verbatim from section 4 into `.claude/settings.json` and every worker-launcher drops `--dangerously-skip-permissions`. The `hooks.PermissionRequest` shim (GSL-304 wiring, in `settings.json`) already routes prompts to the web panel, so a real prompt during the flip is a data point, not a stall.
- **The five-VERB hook layer under-reports.** Section 3.2 explicitly names the gap: any Bash verb outside git-commit / git-push / gh-pr-create / gh-pr-merge / gh-issue-create is invisible in event data. A follow-up under GSL-232 or GSL-180 could log a fixed-window sample of Bash verbs (rate-limited, one line per unique verb per hour) so a future inventory does not have to extrapolate from allow-list membership.
- **MCP read tools.** `mcp__atlassian__search` and `mcp__atlassian__getJiraIssue` are heavy read tools with no PostToolUse hook. Section 4 admits them (read is safe), but the true call count is unknown — same follow-up: hook the read matchers and count.

## 7. Verification — no config file changed

The commit that lands this report must NOT touch `.claude/settings.json` or any other settings file.

```
git diff --name-only HEAD~1..HEAD -- .claude/ apps/core/plist/ | wc -l   # expected: 0
```

If the count is anything other than `0`, this task's discipline was broken; revert and refile.
