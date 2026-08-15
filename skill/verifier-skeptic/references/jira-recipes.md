# Jira recipes for verifier-skeptic

Concrete payloads for filing findings. Obey the `using-jira` skill for all conventions (Epic+Task
hierarchy, assignee = reporter, tagged summaries, the section-glyph ban). This file is the
verifier-specific application of those conventions.

## 1. Resolve the site and the Epic assignee once

```
mcp__atlassian__getAccessibleAtlassianResources()          → cloudId
mcp__atlassian__getJiraIssue({ cloudId, issueIdOrKey: "TLM-360",
  fields: ["assignee", "project", "summary"] })            → Epic assignee accountId + project key
mcp__atlassian__lookupJiraAccountId({ cloudId, searchString: "<owner-email>" })  → accountId (fallback)
```

Cache the `cloudId`, project key, and assignee `accountId` — every finding reuses them.

## 2. Create one finding as a Task under the Epic

```
mcp__atlassian__createJiraIssue({
  cloudId,
  projectKey: "TLM",
  issueTypeName: "Task",
  parentKey: "TLM-360",
  summary: "[Suppliers][Plan] Stage-nav shell absent from layout",
  description: "...(markdown body, see section 3)...",
  responseContentFormat: "markdown",
  additional_fields: {
    assignee: { id: "<epic-assignee-accountId>" },
    labels: ["verifier", "functionality"]
  }
})
```

Save the returned key (e.g. `TLM-432`) — it becomes `findings[].jira` in the report JSON and the
`number` line in the findings list.

**Labels per finding kind:**

| Finding kind          | labels                              |
|-----------------------|-------------------------------------|
| Visual (any lens)     | `["verifier", "pixel-perfect"]`     |
| Architecture gap      | `["verifier", "architecture"]`      |
| Broken/missing flow   | `["verifier", "functionality"]`     |
| Spans lanes           | `["verifier", "pixel-perfect", "architecture"]` (all that apply) |

`verifier` is MANDATORY on every finding, no exceptions — it is the label the fix pipeline filters on.
Add any custom labels the invoker requested (e.g. `phase-24`).

## 3. Description body template (markdown)

Do NOT propose a fix. Describe, cite, evidence, classify.

```markdown
**Context.** The prototype's Plan view wraps content in a 01-04 stage-nav rail; the shipped layout
renders the content region only, so stages 02-04 are unreachable from the UI.

**Design source of truth.** `reference/prototype_v3/suppliers-v4.jsx` (Sv4Plan, lines 120-168)

**Shipped source.** `src/app/(app)/suppliers/plan/page.tsx:55-78`

**Steps to reproduce.**
1. Sign in via the e2e helper and seed a suppliers plan.
2. Navigate to `/suppliers/plan`.
3. Observe the header: no 01-04 rail; no way to reach stage 02.

**Expected (per design).** 01-04 stage rail visible in the Plan header; clicking a stage navigates to it.
**Actual.** No rail rendered; stages 02-04 unreachable.

**Severity: CRITICAL.** A promised navigation path is unreachable from the UI (functional lane rubric).

_Filed by verifier-skeptic. Screenshots attached. Fix approach intentionally not prescribed._
```

For a visual finding, replace the repro block with the measured delta and the screenshot-pair captions:

```markdown
**Measured delta.** borderRadius: shipped 9999px vs prototype 8px. Active-state 2px bottom border absent.
**Evidence.** See attachments: tab-shipped-light.png, tab-prototype-light.png, tab-diff-light.png (pixelmatch ratio 0.021).
```

## 4. Attach screenshots (REST — the MCP has no attachment tool)

Expected: the Atlassian MCP does not expose an attachment tool. Use the REST fallback with
`ATLASSIAN_API_TOKEN` from `.env.local` (that exact name — not `JIRA_API_TOKEN`). Do NOT declare
BLOCKER for a missing attachment tool.

```bash
source .env.local   # loads ATLASSIAN_API_TOKEN

curl -sS \
  -u "<owner-email>:${ATLASSIAN_API_TOKEN}" \
  -H "X-Atlassian-Token: no-check" \
  -X POST \
  -F "file=@.artifacts/audit/plan-shipped-light.png" \
  -F "file=@.artifacts/audit/plan-prototype-light.png" \
  "https://<org>.atlassian.net/rest/api/3/issue/TLM-432/attachments"
```

HTTP 200 with a JSON array of `{id, filename}` = success. If `ATLASSIAN_API_TOKEN` is missing from
`.env.local`, ask the owner to create one at
`https://id.atlassian.com/manage-profile/security/api-tokens` and put it under exactly
`ATLASSIAN_API_TOKEN=...`. When the owner writes that variable name in chat, that is the signal they
just added it — re-check `.env.local` and retry immediately.

## 5. Comment on the Epic with the audit trail (once, after all findings filed)

```
mcp__atlassian__addCommentToJiraIssue({
  cloudId,
  issueIdOrKey: "TLM-360",
  responseContentFormat: "markdown",
  body: "verifier-skeptic audit 2026-07-15 — verdict MINOR-POLISH (73/100): 2 CRITICAL, 11 MAJOR, 7 MINOR.\n\nReport: docs/reports/audit-TLM-360-2026-07-15/index.html\n\nFindings (all labeled `verifier`):\n1. TLM-432 (CRITICAL) — Stage-nav shell absent\n2. TLM-433 (MAJOR) — Plan tab pill vs rectangular\n3. TLM-434 (MINOR) — ...\n"
})
```

## 6. JQL the fix agent uses to pick up the audit output

Give the invoker this query so the follow-up fix agent finds exactly the audit's tickets:

```
project = TLM AND parent = TLM-360 AND labels = verifier ORDER BY priority DESC, created ASC
```

Filter by kind when a fix agent owns one lane:

```
project = TLM AND parent = TLM-360 AND labels = verifier AND labels = pixel-perfect
```

## 7. Idempotency — re-running an audit

**Timing guard (independence — SKILL.md section 6):** this search is a FILING-time step, not a
research step. It runs only *after* a finding is fully formed and written down, and only to decide
create-vs-update for a retry of THIS run. Never search prior `verifier` tickets before or during the
hunt, never browse them for "what to look for", and never let a match edit your finding's content or
severity — a ticket you read before concluding is anchoring, whatever it is labeled.

If the audit re-runs (a crashed worker, a second pass), do NOT blind-create duplicate tickets. Search
first by a stable key before creating:

```
mcp__atlassian__searchJiraIssuesUsingJql({
  cloudId,
  jql: "parent = TLM-360 AND labels = verifier AND summary ~ \"Stage-nav shell absent\"",
  fields: ["summary", "status", "labels"]
})
```

A match → update the existing Task (`editJiraIssue`) instead of creating a second one. Use the exact
finding summary as the stable key so a retry converges on the prior ticket.
