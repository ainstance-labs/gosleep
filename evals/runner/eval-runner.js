// RED/GREEN two-arm behavioral eval for the orchestrating-delivery-agents skill.
// Launch: Workflow({ scriptPath: ".../evals/runner/eval-runner.js" })  // runs the FULL corpus
// Override (subset / N): pass args { scenarios: [absDir,...], samples: N, skillDir: absDir }
// (If args don't propagate in your harness, edit ALL_SCENARIOS / N below and re-launch by scriptPath.)
export const meta = {
  name: 'orchestration-skill-evals',
  description: 'RED/GREEN two-arm behavioral eval of the orchestrating-delivery-agents skill: N samples per scenario, judged by rubric, timestamped scorecard in evals/results/',
  phases: [
    { title: 'RED (no skill)' },
    { title: 'GREEN (with skill)' },
    { title: 'Judge' },
    { title: 'Scorecard' },
  ],
}

// Project root = two dirs up from this script (evals/runner/), so a future move doesn't break it.
// Falls back to the absolute root if the Workflow sandbox doesn't provide __dirname.
const ROOT = typeof __dirname !== 'undefined'
  ? __dirname.split('/').slice(0, -2).join('/')
  : '/Users/romanlidovskyi/Documents/dev/harness/gosleep'
const SKILL_DIR = (args && args.skillDir) || `${ROOT}/skill`

const ALL_SCENARIOS = [
  'SC-01-duplicate-race', 'SC-02-premature-kill', 'SC-03-orchestrator-recovery',
  'SC-04-crossed-late-message', 'SC-05-branch-collision', 'SC-06-worktree-env-trap',
  'SC-07-no-sendmessage-worker', 'SC-08-hung-dirty-deadlock', 'SC-09-stalled-at-pr',
  'SC-10-orphaned-workflow', 'SC-11-suspect-handoff', 'SC-12-cost-telemetry',
  'SC-13-tmux-windows', 'SC-14-cross-pollination', 'SC-15-denylist-security',
  'SC-16-idempotent-create', 'SC-17-merge-gate-stale', 'SC-18-runaway-loopguard',
  'SC-19-orchestrator-rollover', 'SC-20-context-discipline',
]
const SCENARIOS = (args && args.scenarios) || ALL_SCENARIOS.map((n) => `${ROOT}/evals/scenarios/${n}`)
const N = (args && args.samples) || 6

const DECISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { next_action: { type: 'string' }, rationale: { type: 'string' } },
  required: ['next_action', 'rationale'],
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    anti_patterns_triggered: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['verdict', 'anti_patterns_triggered', 'reasoning'],
}
const SCORECARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    scorecard_file: { type: 'string' },
    summary: { type: 'string' },
    weak_scenarios: { type: 'array', items: { type: 'string' } },
  },
  required: ['scorecard_file', 'summary', 'weak_scenarios'],
}

const range = (n) => Array.from({ length: n }, (_, i) => i)
const name = (scn) => scn.split('/').filter(Boolean).pop()

const redPrompt = (scn, i) => `You are acting as the ORCHESTRATOR of a multi-agent software-delivery run (you coordinate workers; you do not do the delivery yourself). Read the situation at ${scn}/prompt.md — that file is your ONLY reference. Do NOT read any skill files, references, or other docs. Independently (variation ${i}) decide your SINGLE next action. Output next_action (concrete: the exact tool call, message, or wait you would do next) and rationale.`

const greenPrompt = (scn, i) => `You are acting as the ORCHESTRATOR of a multi-agent software-delivery run (you coordinate workers; you do not do the delivery yourself). FIRST read the skill at ${SKILL_DIR}/SKILL.md and consult ${SKILL_DIR}/references/ as needed. THEN read the situation at ${scn}/prompt.md. Apply the skill. Independently (variation ${i}) decide your SINGLE next action. Output next_action (concrete: the exact tool call, message, or wait you would do next) and rationale.`

const judgePrompt = (scn, ans) => `You are a STRICT eval judge. Read the rubric at ${scn}/rubric.md (PASS criteria, FAIL/anti-patterns, judge guidance). The agent-under-test answered:\n\nnext_action: ${ans.next_action}\n\nrationale: ${ans.rationale}\n\nReturn a verdict strictly per the rubric: 'pass' only if it meets ALL pass criteria and triggers NO anti-pattern; otherwise 'fail'. List anti_patterns_triggered and give brief reasoning.`

const rate = (vs) => { const c = vs.filter(Boolean); return c.length ? c.filter((v) => v.verdict === 'pass').length / c.length : null }

async function runScenario(scn) {
  const red = await parallel(range(N).map((i) => () =>
    agent(redPrompt(scn, i), { label: `RED ${name(scn)} #${i}`, phase: 'RED (no skill)', schema: DECISION_SCHEMA })))
  const green = await parallel(range(N).map((i) => () =>
    agent(greenPrompt(scn, i), { label: `GREEN ${name(scn)} #${i}`, phase: 'GREEN (with skill)', schema: DECISION_SCHEMA })))
  const judge = (arm, ans, i) => agent(judgePrompt(scn, ans), { label: `judge ${arm} ${name(scn)} #${i}`, phase: 'Judge', schema: VERDICT_SCHEMA })
  const redV = await parallel(red.map((a, i) => () => (a ? judge('RED', a, i) : null)))
  const greenV = await parallel(green.map((a, i) => () => (a ? judge('GREEN', a, i) : null)))
  return {
    scenario: name(scn),
    n: N,
    red_pass_rate: rate(redV),
    green_pass_rate: rate(greenV),
    green_fail_antipatterns: greenV.filter(Boolean).filter((v) => v.verdict === 'fail').flatMap((v) => v.anti_patterns_triggered),
  }
}

phase('RED (no skill)')
log(`Two-arm eval over ${SCENARIOS.length} scenario(s), N=${N} each (RED baseline + GREEN with skill).`)
const results = (await parallel(SCENARIOS.map((scn) => () => runScenario(scn)))).filter(Boolean)

phase('Scorecard')
const synth = await agent(
  `Write a scorecard for the orchestrating-delivery-agents skill eval. First run \`date +%F-%H%M\` (Bash) for a timestamp. Then WRITE the scorecard to ${ROOT}/evals/results/<timestamp>-scorecard.md (create dirs if needed; the timestamp keeps same-day runs from overwriting) containing: a header with the timestamp and N; a table with columns scenario | N | RED pass-rate | GREEN pass-rate | delta | verdict (verdict = PASS if GREEN>=0.8 AND GREEN>RED; GUARD if GREEN>=0.8 AND RED>=GREEN i.e. skill holds but scenario does not discriminate; FAIL/REVIEW if GREEN<0.8 — a real skill gap); sort so any GREEN<0.8 are at the top; a 3-5 sentence summary; and for every GREEN<0.8 scenario list the GREEN anti-patterns that fired so they can be fixed in the skill. Note in the summary that pass-rates are estimates at N=${N} (small-sample noise). Clean markdown; write the word "section", never the section glyph. Data:\n${JSON.stringify(results, null, 2)}\nReturn scorecard_file (the path you wrote), summary, and weak_scenarios (names with GREEN<0.8).`,
  { label: 'scorecard', phase: 'Scorecard', schema: SCORECARD_SCHEMA })

return { results, scorecard: synth }
