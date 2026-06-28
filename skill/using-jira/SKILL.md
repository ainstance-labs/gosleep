---
name: using-jira
description: Use when interacting with Jira — creating, updating, transitioning, commenting, or querying issues via the Atlassian Rovo MCP. Encodes the user's Jira conventions: Epic + Task hierarchy only (no Story — free Jira tier limitation), one PR per Epic, one commit per Task, GitHub Issues mirror per repo.
---

# Working with Jira (via Atlassian Rovo MCP)

## When this applies
- Any request involving Jira issues (create, update, transition, comment, search, link).
- References to Jira issue keys like `<PROJECT>-<N>` (e.g. `AGW-1`).
- Phrases: "make/update/close a ticket", "log this in Jira", "set up a Jira project tree", "create epic", "create task", "transition", "Atlassian".

## MCP server (Atlassian Rovo)
- Server name: `atlassian` (`https://mcp.atlassian.com/v1/mcp`, OAuth).
- Tools start with `mcp__atlassian__*` (e.g. `mcp__atlassian__createJiraIssue`, `getJiraIssue`, `transitionJiraIssue`, `searchJiraIssuesUsingJql`, `getAccessibleAtlassianResources`, `getVisibleJiraProjects`, `addCommentToJiraIssue`, `getTransitionsForJiraIssue`, `createIssueLink`).
- **Bootstrap pattern:** if a tool isn't loaded in the current session, call `ToolSearch` with `select:mcp__atlassian__<name>[,...]` to load schemas before invoking.
- **GOTCHA:** Claude Code loads MCP tools only at session start. If `mcp__atlassian__*` is missing entirely, the user must `/mcp` reconnect or restart the session — the server is OAuth'd at the user level, no re-auth needed.

## User's Jira conventions (apply unless explicitly overridden per-project)

### Hierarchy
**Epic + Task only.** No Story.

Reason: Jira free tier puts Story at the same hierarchical level as Task — Story cannot parent Task. So Story adds no value over Task; we skip it entirely and use only Epic (the only "above-Task" level on free tier) and Task.

```
Epic
 ├─ Task
 ├─ Task
 └─ Task
```

### PR + commit rules
- **One PR per Epic.** Each Epic = one shippable unit = one GitHub PR.
- **One commit per Task.** Each Task within the Epic lands as a single atomic commit in the Epic's PR. Multiple Tasks → multiple commits in one PR.
- **Do NOT open a PR per Task.** Tasks are commit-sized, not PR-sized.

### Naming
- **Issue summary starts with section tags in square brackets** — 1-3 `[Tag]` markers naming the
  area the work belongs to, then a plain description:
  `[Server][Clients][Onboarding] Persist wizard profile`, `[UI][Auth] Login and signup pages`.
  Without tags the owner cannot tell at a glance what area a task touches. Reuse the project's
  existing tag vocabulary before inventing a new tag (look at sibling issues; typical tags:
  `[UI]`, `[Server]`, `[Admin]`, `[Auth]`, `[Onboarding]`, `[Registry]`, `[Constructor]`,
  `[Billing]`, `[AI]`, `[Docs]`, `[E2E]`, `[Deploy]`). Title-case tags; never the section glyph.
- **Assignee: always assign the issue to the reporter (the owner) at create time** — a board
  full of "Unassigned" looks broken to the owner. Resolve the accountId once via
  `lookupJiraAccountId` (owner's email) and pass it on `createJiraIssue` / fix retroactively
  with `editJiraIssue`.
- **Branch:** `<EPIC-KEY>-<slug>` (e.g. `AGW-5-bulk-lead-enrichment`). One branch per Epic.
- **Commit message:** starts with the Task key — `AGW-N short description`. GitHub-for-Atlassian then shows the commit in the Jira Development panel against the Task.
- **PR title:** starts with the Epic key — `<EPIC-KEY> Title` (e.g. `AGW-5 Bulk Lead Enrichment`).
- **PR body:** include `Implements <EPIC-KEY>.` plus a Tasks checklist (`- [x] AGW-N1 ...`) and the mirrored GitHub Issue ref (`Mirrors GH #<n>.`).

### Cross-link with GitHub Issues (when the repo uses this convention)
At Jira issue create-time, also `gh issue create` a mirrored GitHub Issue:
- GitHub Issue body includes the Jira key + URL.
- Jira gets a remote link: `POST /rest/api/3/issue/{key}/remotelink` with stable `globalId = github-issue=<org>/<repo>#<n>` (idempotent — re-POST updates the same link, no duplicates).
- The remote-link step needs a Jira API token (separate from MCP OAuth) — create at https://id.atlassian.com/manage-profile/security/api-tokens. Only used for the remote-link REST call; everything else goes through the MCP.

## Common operations

### Discover site + accessible projects
```
mcp__atlassian__getAccessibleAtlassianResources()  → cloudId (or use the site hostname like "<org>.atlassian.net" directly)
mcp__atlassian__getVisibleJiraProjects({ cloudId, action: "create" })  → list of projects (key, name, type)
```

### Find the right Jira project
- Check the project's planning docs (typically `docs/plans/*` in the repo) for the canonical project key.
- Fall back to `getVisibleJiraProjects` with a `searchString`.

### Create an Epic
```
mcp__atlassian__createJiraIssue({
  cloudId,
  projectKey: "<PROJECT>",
  issueTypeName: "Epic",
  summary: "...",
  description: "...",  // ADF or markdown (use responseContentFormat: "markdown" for simpler input)
})
```
Save the returned key (e.g. `AGW-5`) and record back in the project's planning doc.

### Create a Task under an Epic
```
mcp__atlassian__createJiraIssue({
  cloudId,
  projectKey: "<PROJECT>",
  issueTypeName: "Task",
  summary: "...",
  description: "...",
  parentKey: "<EPIC-KEY>",  // e.g. "AGW-5"
})
```
Confirm the Task appears under the Epic (in Backlog/Timeline — see "Team-managed boards" gotcha below).

### Transition status
```
mcp__atlassian__getTransitionsForJiraIssue({ cloudId, issueIdOrKey })  → list of available transitions with ids
mcp__atlassian__transitionJiraIssue({ cloudId, issueIdOrKey, transitionId })
```

### Comment
```
mcp__atlassian__addCommentToJiraIssue({
  cloudId,
  issueIdOrKey,
  body: "...",
  responseContentFormat: "markdown",  // keep it simple
})
```

### Search (JQL)
```
mcp__atlassian__searchJiraIssuesUsingJql({
  cloudId,
  jql: "project = AGW AND type = Epic ORDER BY created ASC",
  fields: ["summary", "status", "issuetype", "parent"],
  maxResults: 50,
})
```
Useful JQL:
- All Epics in a project: `project = AGW AND type = Epic ORDER BY created ASC`
- Tasks under a specific Epic: `parent = AGW-5` (or `"Epic Link" = AGW-5` on older Jira instances)
- My open work: `assignee = currentUser() AND status != Done`
- Specific issue: `AND key = AGW-1`

### Link two issues
```
mcp__atlassian__getIssueLinkTypes({ cloudId })  → list of relation types (Relates, Blocks, etc.)
mcp__atlassian__createIssueLink({ cloudId, inwardIssueKey, outwardIssueKey, linkTypeName })
```

## Free Jira tier gotchas

### Story vs Task hierarchy
Free tier puts Story at the same hierarchical level as Task; Story cannot parent Task. This is why we use Epic + Task only. If a free-tier project insists on Story, treat it as a Task-equivalent — DON'T try to put Tasks under it.

### Team-managed boards hide Epics from the board itself
In team-managed (next-gen) software projects, Epics never render as cards on the Scrum/Kanban board. They appear only in **Backlog** and **Timeline**, and surface as Epic badges/swimlanes on their **child** cards. If a user reports "I can't see my Epic on the board" — that's by design; tell them to look at Backlog/Timeline, or create at least one child Task so the Epic surfaces as a swimlane/badge.

### Board type: prefer Kanban, not Scrum
The owner works from the issue LIST and a board, never from sprints. A Scrum board shows nothing
until a sprint is created and issues are pulled into it — so on a Scrum board all agent-created
tasks are invisible ("I don't see anything in board"). Prefer a **Kanban board** (shows all issues
by status, no sprint required). The Rovo MCP has NO board-management API — creating/switching a
board is a one-minute owner action in the Jira UI (Board menu -> Create board -> Kanban, filter =
the project). Agents must NEVER create sprints or assume one exists; if the owner reports an empty
board, explain the Scrum-vs-Kanban cause and point them to the UI step.

### Smart-commit transitions
On the cloud GitHub-for-Atlassian app, `#transition` / `#time` smart commits are limited; **issue-key linking (Development panel) always works**. If smart-commit transitions are wanted, set the committing identity's `git config user.email` to a real Jira-account email — but don't rely on it.

### Account joining an Organization
When a Jira account joins an AWS Organization or Control Tower landing zone, Free Tier credits and quotas can be invalidated. Unrelated to Jira itself but watch for it on linked Atlassian + AWS accounts.

## When NOT to use this skill
- Pure Confluence operations (use Confluence-specific tools like `mcp__atlassian__createConfluencePage`, etc. — same MCP server, different toolset).
- Non-Jira issue trackers (GitHub Issues alone, Linear, Asana, etc.).

## Per-project specifics
Always check the project's planning docs (typically `docs/plans/*` or similar) for:
- The canonical project key (the prefix before the `-N`; e.g. `AGW`, `AFA`).
- The Epic tree (which Epics exist for the current initiative, what's under each).
- Whether GitHub Issues mirror is wired for that repo (some projects skip it).
- Any project-specific overrides to the conventions above (per-repo `CONVENTIONS.md` or similar).
