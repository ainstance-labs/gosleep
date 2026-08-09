---
name: delivery-workflow
description: Use when delivering coding work against Jira + GitHub for this team's process — structuring or executing an epic/phase, creating issues, branches, commits, PRs, and per-task dev history. Encodes the conventions: Epic+Task only, ONE PR per Epic, ONE commit per Task, branches prefixed with the Jira ticket key, GitHub Issues mirror Jira, tagged issue summaries, assignee = reporter, and a docs/dev_history file per Task. Asks for the Jira workspace URL and GitHub repo on first use to connect. Builds on the using-jira skill.
---

# Delivery workflow (Jira + GitHub + dev history)

This is the team's end-to-end delivery process. It **layers GitHub, branch/commit/PR rules,
and a per-epic dev-history log on top of the `using-jira` skill**. Load `using-jira` for all
Jira mechanics; this skill must never contradict it.

> **FIRST, invoke the `using-jira` skill** (via the Skill tool). It owns Jira mechanics
> (cloudId discovery, issue create/transition, JQL, the Epic+Task hierarchy, the smart-commit
> caveats). Everything below assumes it is loaded.

## 0. Connect (do this once per project, before anything else)

Ask the user for, and record, the two anchors — do not guess them:

1. **Jira workspace/project URL** — e.g. `https://<org>.atlassian.net/jira/software/projects/<KEY>/...`.
   From it resolve: the site (`<org>.atlassian.net`), the **cloudId**
   (`mcp__atlassian__getAccessibleAtlassianResources`), and the **project key** (`<KEY>`, the
   prefix before `-N`). Confirm with `mcp__atlassian__getVisibleJiraProjects`.
2. **GitHub repo URL** — e.g. `https://github.com/<owner>/<repo>`. Verify with
   `gh repo view <owner>/<repo>`; confirm `gh auth status` is logged in.

Use `AskUserQuestion` (or a direct ask) if either is missing. **Persist these** for future
sessions: write the project key + repo to the repo's `CLAUDE.md` (or a `docs/PROJECT.md`) so the
connection survives context resets. If the repo is empty / not a git repo, bootstrap `main` first
(init, `.gitignore`, baseline commit, `gh repo` remote, push, set default branch).

## 1. Conventions (non-negotiable)

- **Hierarchy: Epic + Task only** (per `using-jira` — Story adds nothing on free tier). Epics map
  to large shippable units (a phase / a feature area). Tasks are commit-sized slices under an Epic.
- **One branch per Epic**, named **`<EPIC-KEY>-<slug>`** — it **starts with the Jira ticket key**
  (e.g. `TLM-2-identity-tenancy`). Branch off the up-to-date default branch.
- **One commit per Task.** The commit message **starts with the Task key**: `TLM-15 short description`.
  Commits are **large and coherent** (a whole task/story), not many tiny ones. GitHub-for-Jira then
  shows each commit against its Task in the Development panel.
- **One PR per Epic.** Few PRs overall. PR **title starts with the Epic key**: `TLM-2 <Epic title>`.
  PR **body**: `Implements <EPIC-KEY>.` + a Tasks checklist (`- [x] TLM-15 … (#<gh>)`) + `Mirrors GH #<n>.`
  + `Closes #<epic>, #<task>, …`. **Never open a PR per Task.**
- **CI must be green before merge.** Run the project's gates locally first (typecheck, lint,
  boundary/dependency checks, tests, build) — "verified by running, not by compiling".

## 2. GitHub mirror (Issues duplicate Jira)

At Jira **create-time**, also create a mirrored **GitHub Issue** for each Epic and Task:

- `gh issue create --title "<KEY>: <summary>" --label epic|task --body "Mirrors Jira [<KEY>](<jira-url>). …"`
  (Epic body: roadmap ref. Task body: parent epic link + GH ref.)
- Put the **Jira key + URL in the GH issue body**; put the **GH issue ref back in Jira** (a remote
  link if a Jira API token is available, otherwise a Jira comment).
- **Numbering caveat:** GitHub shares one counter for issues **and** PRs, so once a PR is opened the
  1:1 `GH#N == TLM-N` mapping breaks — rely on the in-body cross-links, not the number.
- On merge, GitHub auto-closes only the **first** issue in a `Closes #a, #b` list — close the rest
  with `gh issue close` individually.

## 3. Dev history (one file per TASK) + wiki

The unit of dev history is the **Jira Task** — one file per task, written RIGHT AFTER the task's
commit lands, while the details are fresh. This is the project's real engineering memory: a future
agent (or the owner) debugging something runs through these files task-by-task to see what was
actually built, what hurt, and where the bodies are buried.

- **Path:** `docs/dev_history/<TASK-KEY>-<phase>-<slug>.md` — the task key COMES FIRST and is
  ALWAYS UPPERCASE exactly as in Jira; then the phase; then a short slug. When a project runs
  orchestrated cycles, an optional `-cycle<N>-` may appear between `<phase>` and `<slug>` (e.g.
  `TLM-82-phase9-cycle6-constructor-grid.md`); when the project does NOT use cycles (gosleep
  today), the format is the tighter `GSL-N-phaseM-slug.md` — matches the project's `CLAUDE.md`
  and the existing `docs/dev_history/` history. Key-first keeps the directory sorted by task
  and greppable by key.
- **Structure — Part 1, plain developer's language (the point of the file).** Five headings,
  written like the developer telling a teammate what happened — accessible sentences, "I built
  the grid component and wired it to the placement actions, so now dragging a dish into a day
  actually saves" — not jargon dumps:
  1. `## What was done` — what now exists and works, in human sentences.
  2. `## Problems solved` — the difficulties hit during the task and how they were beaten.
  3. `## Problems remaining` — honest open issues this task leaves behind (or "none").
  4. `## Pitfalls & workarounds` — the subtle traps, the kludges/"костыли" knowingly applied,
     any architecture decisions (ADR-worthy calls) made or touched, things a future debugger
     must know before touching this code.
  5. `## What didn't make it` — anything attempted-but-dropped or deliberately deferred, and why.
- **Part 2, short technical reference (below the human part):** commit SHA, key files/modules
  touched, migrations, new use-cases/actions, how it was **verified by running something**
  (gates + in-browser checks), links (Jira key, GH issue, review report if any).
- Keep `docs/dev_history/README.md` (the index) current — group entries by phase/epic.
- **Optional — LLM wiki.** If AND ONLY IF the project keeps an LLM wiki at `docs/wiki/`
  (many do not — for example gosleep does not), update its **status page** (epics, progress,
  PRs, commits) and the **dev-history index** so the wiki never goes stale. Projects without
  `docs/wiki/` skip this bullet entirely — do NOT create the directory on the fly, and do NOT
  fail a task because the wiki is absent.
- **Only real landed work** goes in dev history — never future plans, never unlanded code.

## 4. Per-epic playbook

1. **Plan the Epic** → create the **Epic** in Jira; break it into commit-sized **Tasks** (parented to
   the Epic). Mirror Epic + Tasks to **GitHub Issues** (§2). Transition the Epic → *In Progress*.
2. **Branch**: `git checkout -b <EPIC-KEY>-<slug>` off the current default branch.
3. **Execute task by task.** For each Task: build it; run the gates; verify by RUNNING it (for UI
   work delegate the browser check to a single cheap-model subagent — screenshots, flows, console);
   **one commit** `TLM-N …`; **write the per-task dev-history file** (section 3) + update the index;
   transition the Task → *Done* or *In Review* (the commit links it). Do NOT use the multi-agent
   Workflow tool inside delivery work — single helper subagents only (one browser-verifier, one
   grouped skeptic), per the team's model-economy policy.
4. **Open the Epic PR** when all Tasks are committed: title `<EPIC-KEY> …`, body per §1. Push the
   branch first. Transition the Epic → *In Review*.
5. **Green CI**, then **merge** (regular merge preserves the per-task commits; squash collapses them —
   prefer regular merge to keep one-commit-per-task history). Delete the branch.
6. **Close out**: close the Epic + Task GitHub issues; transition the Epic → *Done*; update
   the dev-history index (`docs/dev_history/README.md`). If the project keeps an LLM wiki
   (`docs/wiki/status.html`), update the status page there too — otherwise skip it. Pull
   `main`; start the next Epic from step 1.

## 5. Guardrails

- Secrets (DB URLs, API keys) go only in git-ignored env files (`.env.local`), never committed, never
  echoed. DDL against a real/shared database needs explicit owner confirmation first.
- Don't push or open PRs unless asked or clearly within an authorized epic flow; confirm before
  merging if branch protection or review is expected.
- Keep status truthful across Jira, GitHub, and the wiki — they must agree.
