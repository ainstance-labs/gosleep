// Builds the HTML knowledge base in report/ — one agent per page, parallel, shared CSS + data.
// Launch: Workflow({ scriptPath: ".../report/build-report.js" })
export const meta = {
  name: 'build-harness-report',
  description: 'Build the professional HTML knowledge-base dashboard (index + 7 pages) from runs.json + source files; cross-linked, charted; then a link-checker pass',
  phases: [{ title: 'Build pages' }, { title: 'Link check' }],
}

// Project root = two dirs up from this script (docs/report/), so a future move doesn't break it.
// Falls back to the absolute root if the Workflow sandbox doesn't provide __dirname.
// Post-move layout: skill/, evals/, README.md sit at the root; report/, design/, dev-history/ under docs/.
const SRC = typeof __dirname !== 'undefined'
  ? __dirname.split('/').slice(0, -2).join('/')
  : '/Users/romanlidovskyi/Documents/dev/harness/gosleep'
const REPORT = `${SRC}/docs/report`
const DATA = `${REPORT}/data/runs.json`

const TEMPLATE = `EVERY page MUST use this exact skeleton (fill TITLE, set the matching nav link to class="active", fill MAIN):
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TITLE — Orchestration Harness</title>
<link rel="stylesheet" href="assets/style.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
<header class="topbar"><div class="inner">
  <a class="brand" href="index.html">Orchestration Harness<span class="dot">.</span></a>
  <nav>
    <a href="index.html">Dashboard</a>
    <a href="skill.html">Skill</a>
    <a href="scenarios.html">Scenarios</a>
    <a href="runs.html">Runs</a>
    <a href="agents.html">Agents &amp; Profiling</a>
    <a href="architecture.html">Architecture</a>
    <a href="glossary.html">Glossary</a>
    <a href="dev-history.html">Dev-history</a>
  </nav>
</div></header>
<main class="container">
  ... MAIN ...
</main>
<footer>Orchestration Harness knowledge base · generated for development profiling · Jira epic TLM-58 · source: docs/orchestration-harness/</footer>
</body>
</html>`

const RULES = `SHARED RULES for the whole knowledge base:
- Audience: developers profiling how this harness was built, AND agents browsing the index to find docs then dive deeper. So: professional dashboard look, but ACCESSIBLE — explain the logical chain.
- Language: Russian prose, English for technical terms. The FIRST time a non-obvious term appears on a page, wrap it like <a class="term" href="glossary.html#term-SLUG">term</a> linking to the glossary.
- Use the shared CSS classes from assets/style.css: .card, .grid/.kpis/.cards-2/.cards-3, .kpi (.num/.lbl/.sub), table with .num cells, .badge (.b-pass/.b-fail/.b-guard/.b-pending/.b-prog/.b-done/.b-delivery/.b-harness), .note(.warn/.danger), .chart-wrap, .tree (.node-orch/.node-wf/.node-sub/.meta), .lead, .muted.
- DATA: read ${DATA} for all numbers (telemetry, scenarios, cycles). Do NOT invent numbers; use the file. Format large token counts readably (e.g. 9.07M, 14.6M).
- Charts: use Chart.js (already loaded). Each chart = a <canvas id="..."> inside a .chart-wrap + an inline <script> that builds it with the data embedded as JS arrays (copy numbers from runs.json). Set dark theme on each chart: Chart.defaults.color = '#9da7b3'; and per-chart options.scales.x/y.grid.color = '#30363d', ticks color '#9da7b3'. Keep charts simple (bar/doughnut).
- Cross-linking (use these EXACT anchors so links resolve):
  * scenarios: scenarios.html#SC-01 .. #SC-20
  * edge cases: skill.html#E1 .. #E16
  * workflow runs: runs.html#run-<id> and agents.html#run-<id> where <id> in {w22r94p88, wt2ajzijl, wka1y0ile, wgr53dz8h, wv9e4ygbg, wlw9qhhhm, wragtqbc2}
  * glossary terms: glossary.html#term-<slug>
  * dev-history: dev-history.html#dh-01 .. #dh-07
  * Jira: link keys to https://ainstance-labs.atlassian.net/browse/<KEY>
- Every page sets scroll-margin via the shared CSS (anchors already offset). Give every <section> an id where it makes sense.
- Write the word "section" (never the section glyph).`

const PAGES = [
  { file: 'index.html', title: 'Dashboard', spec: `THE DASHBOARD / landing page. Include: (1) a hero <h1> + .lead explaining what this knowledge base is and that it documents how we built the orchestration harness (skill + evals + observability). (2) A "for agents browsing" .note: how to use this index — skim the nav, jump to a page, follow cross-links. (3) KPI cards (.kpis grid) from runs.json.summary: workflow runs, total subagents (635), total tokens (~14.6M), total tool-uses, eval scenarios (20), delivery cycles (9). (4) A compact eval-results summary: counts of PASS/GUARD/FAIL/PENDING across the 20 scenarios (compute from runs.json.scenarios) shown as badges + a small doughnut chart. (5) A Jira progress table (TLM-58 epic + TLM-59..66 tasks) with status badges and links — get titles/status from runs.json + dev-history (TLM-59/60/61/62/65/66 Done, TLM-63 In Progress, TLM-64 To Do, TLM-66 Done). (6) A "system map" using a .tree: orchestrator -> the 7 workflow runs -> their subagents, and the 9 delivery cycles. (7) A nav grid (.cards-3) of cards linking to each page with a one-line description. Cross-link generously.` },
  { file: 'skill.html', title: 'Skill', spec: `Explain the skill "orchestrating-delivery-agents". READ ${SRC}/skill/SKILL.md and ${SRC}/skill/references/*.md for accuracy. Include: (1) the core principle + the 3 roles (orchestrator, cycle-worker, handoff) with plain explanations. (2) section id="model". (3) section id="lifecycle": describe the spawn->monitor->terminate->chain protocol and the idle-decision logic (the two failure modes it prevents) in words/lists (do not paste the dot graph; explain it). (4) section id="edge-cases": the 16-entry edge-case catalog — for EACH, a subsection with id="E1".."E16", the title (from runs.json.skill.edge_cases), a 2-3 sentence plain explanation of the trap + the correct handling, and a cross-link "tested by SC-xx ->" to scenarios.html#SC-xx (map by axis: E1->SC-01, E2->SC-02, E3->SC-04, E4->SC-05, E5->SC-06, E6->SC-07, E7->SC-08, E8->SC-09, E9->SC-10, E10->SC-11, E11->SC-12, E12->SC-13, E13->SC-14, E14->SC-15, E15->SC-16, E16->SC-17; also durability->SC-03/SC-19, budget->SC-18, leanness->SC-20). Explain terms via glossary links.` },
  { file: 'scenarios.html', title: 'Scenarios', spec: `The eval scenario corpus. READ the per-scenario files at ${SRC}/evals/scenarios/SC-*/prompt.md and rubric.md for detail, and runs.json.scenarios for axis/red/green/verdict. Include: (1) an overview table: id (anchor link), axis (link to skill.html#Exx), what it tests, RED pass-rate, GREEN pass-rate, verdict badge (b-pass/b-guard/b-fail/b-pending). Add a .note explaining RED/GREEN/verdicts (link glossary). (2) For each scenario a section id="SC-01".."SC-20": what it tests, the "RED temptation" (why the wrong action is tempting — summarize from prompt.md), the correct action (from rubric PASS criteria), and the measured RED->GREEN result with a verdict badge. Mark GREEN PENDING ones clearly (resume in progress). Cross-link each to its edge case (skill.html#Exx) and to runs.html (the run that produced the numbers, #run-wlw9qhhhm).` },
  { file: 'runs.html', title: 'Runs', spec: `The workflow runs (telemetry). Use runs.json.workflows. Include: (1) a telemetry table: name, phase badge (b-delivery/b-harness), agents, tokens, tool-uses, duration (convert ms to min). (2) THREE bar charts in .chart-wrap: tokens per run, subagents per run, duration(min) per run (embed the numbers). (3) For each run a section id="run-<id>": purpose, structure (fan-out shape), output. Explain what a Workflow / fan-out / subagent is via glossary links. Note the weekly-limit interruption on run wlw9qhhhm and the resume wragtqbc2. Cross-link to agents.html#run-<id> for the chain view and to scenarios for the eval runs.` },
  { file: 'agents.html', title: 'Agents & Profiling', spec: `THE PROFILING page — the subagent chain, for a developer to deeply understand the work. Use runs.json (workflows + delivery_cycles). Include: (1) section id="tree": a big .tree showing the chain — the orchestrator at the root, then each of the 7 workflow runs as node-wf children with their subagent roles + counts as node-sub leaves (e.g. harden = 8 axis reviewers + 1 synth; gen-scenarios = 18 authors; eval runs = per scenario: N RED + N GREEN agents-under-test + judges + scorecard; review = 8 dimension reviewers -> 3 skeptics each -> synth). Use .meta for counts/tokens. (2) section id="cycles": a second .tree of the 9 delivery_cycles (the tmux teammates the skill was distilled FROM) with role + outcome; mark the two that became lessons (cycle-2 race -> SC-01, cycle-5 premature-kill -> SC-02) and link to those scenarios. (3) section id="profiling": per-workflow profiling notes (fan-out structure, where tokens went) + a doughnut or bar chart of subagents-by-run or tokens-by-phase (delivery vs harness). Explain orchestrator/worker/judge/fan-out via glossary links. Cross-link each run to runs.html#run-<id>.` },
  { file: 'architecture.html', title: 'Architecture', spec: `How the harness is built + the observability design. READ ${SRC}/docs/design/event-schema.md and ${SRC}/docs/design/web-harness-design.md and ${SRC}/README.md. Include: (1) section id="layout": the project layout (skill/ source -> install.sh -> active skill; evals/ pipeline; design/; report/) as a tree + explanation. (2) section id="eval-pipeline": how a scenario flows through the RED/GREEN runner + judge -> scorecard (a small flow described in words/boxes). (3) section id="observability": the future live harness — the event-schema-first principle, SSE vs WebSocket, Next.js stack, tmux as raw view, Claude Agent SDK option; section id="event-schema" listing the proposed event types. Explain SSE / event stream / Agent SDK via glossary links.` },
  { file: 'glossary.html', title: 'Glossary', spec: `The term hub — every other page links here. Define each term with a section id="term-SLUG": a plain 1-3 sentence explanation + "where it shows up" cross-links. Cover at least these slugs: orchestrator, cycle-worker, handoff, subagent, workflow, fan-out, red-green, judge, pass-rate, verdict-pass, verdict-guard, verdict-fail, edge-case, eval, rubric, tmux-pane, taskstop, shutdown-response, idempotent-create, denylist, loop-guard, worktree, sse, event-schema, agent-sdk, telemetry. Group them under a few <h2> sections (Roles, Eval terms, Lifecycle/Failure terms, Observability terms). Keep it scannable (one .card or definition block per term is fine).` },
  { file: 'dev-history.html', title: 'Dev-history', spec: `Render the build chronology. READ ${SRC}/docs/dev-history/00-README.md and 01..07. For each numbered doc, a section id="dh-01".."dh-07": the title, the Jira link, and a faithful but tightened HTML rendering of its "what we did / where we are / what problem we solve" plus its emoji status mini-table. Start with the overall progress table from 00-README. Cross-link each doc to its Jira task and to the relevant page (e.g. dh for scenarios -> scenarios.html, dh for runs -> runs.html).` },
]

phase('Build pages')
log(`Building ${PAGES.length} HTML pages for the knowledge base.`)
const built = await parallel(PAGES.map((p) => () =>
  agent(
    `Write ONE page of a professional HTML knowledge base to ${REPORT}/${p.file}.

${TEMPLATE}

${RULES}

THIS PAGE (${p.file}, nav title "${p.title}" — set its nav link active):
${p.spec}

Make it genuinely good: clean, accessible, cross-linked, with the charts/tables described. Write the file now, then return the filename and a one-line note of what you produced.`,
    { label: `page ${p.file}`, phase: 'Build pages', schema: { type: 'object', additionalProperties: false, properties: { file: { type: 'string' }, note: { type: 'string' } }, required: ['file', 'note'] } }
  )
))

phase('Link check')
const check = await agent(
  `Verify the HTML knowledge base in ${REPORT}. Read each of these files: index.html, skill.html, scenarios.html, runs.html, agents.html, architecture.html, glossary.html, dev-history.html. Check that (a) every internal href="page.html#anchor" points to an anchor id that actually exists in the target file, (b) the shared nav + assets/style.css link are present on each page, (c) no page is empty/truncated. Return a list of broken or missing cross-links (file -> bad link) and any structural problems. If a fix is small and obvious (e.g. a missing id on a section that is linked to), apply it directly with Edit. Then return a concise findings summary.`,
  { label: 'link-check', phase: 'Link check', schema: { type: 'object', additionalProperties: false, properties: { broken_links: { type: 'array', items: { type: 'string' } }, fixes_applied: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['broken_links', 'fixes_applied', 'summary'] } })

return { pages: built.filter(Boolean).map((b) => b && b.file), link_check: check }
