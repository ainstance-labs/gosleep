// RED/GREEN two-arm behavioral eval for the orchestrating-delivery-agents skill.
//
// LAUNCH (always requires an explicit scenarios list — never silently runs all 23):
//   Option A — via run-config.json:
//     cp evals/runner/run-config.example.json evals/runner/run-config.json
//     # edit scenarios list, then:
//     Workflow({ scriptPath: ".../evals/runner/eval-runner.js" })
//
//   Option B — via args:
//     Workflow({ scriptPath: ".../evals/runner/eval-runner.js",
//       args: { scenarios: ['SC-01-duplicate-race', 'SC-02-premature-kill'],
//               samples: 3, useCachedRed: true, agentModel: 'sonnet', judgeModel: 'haiku' } })
//
// Config precedence (lowest → highest): built-in defaults → run-config.json → args.
// Fields: scenarios (array, REQUIRED), samples, samplesByScenario, skillDir,
//         useCachedRed, agentModel, judgeModel, confirmLargeRun.
//
// SAFETY: if scenarios is absent/empty → THROWS immediately (never defaults to all 23).
//         if expectedAgents > 120 and confirmLargeRun != true → THROWS before first spawn.

export const meta = {
  name: 'orchestration-skill-evals',
  description: 'RED/GREEN two-arm behavioral eval of the orchestrating-delivery-agents skill: N samples per scenario, judged by rubric, timestamped scorecard in evals/results/',
  phases: [
    { title: 'Config' },
    { title: 'RED (no skill)' },
    { title: 'GREEN (with skill)' },
    { title: 'Judge' },
    { title: 'Scorecard' },
  ],
}

// Project root = two dirs up from this script (evals/runner/), so a future move doesn't break it.
const ROOT = typeof __dirname !== 'undefined'
  ? __dirname.split('/').slice(0, -2).join('/')
  : '/Users/romanlidovskyi/Documents/dev/harness/gosleep'

// ALL_SCENARIOS — reference only, NEVER used as a silent default.
// To run all scenarios explicitly, copy this list into run-config.json or args.scenarios.
const ALL_SCENARIOS = [
  'SC-01-duplicate-race', 'SC-02-premature-kill', 'SC-03-orchestrator-recovery',
  'SC-04-crossed-late-message', 'SC-05-branch-collision', 'SC-06-worktree-env-trap',
  'SC-07-no-sendmessage-worker', 'SC-08-hung-dirty-deadlock', 'SC-09-stalled-at-pr',
  'SC-10-orphaned-workflow', 'SC-11-suspect-handoff', 'SC-12-cost-telemetry',
  'SC-13-tmux-windows', 'SC-14-cross-pollination', 'SC-15-denylist-security',
  'SC-16-idempotent-create', 'SC-17-merge-gate-stale', 'SC-18-runaway-loopguard',
  'SC-19-orchestrator-rollover', 'SC-20-context-discipline',
  'SC-21-hung-browser-verifier', 'SC-22-verify-request', 'SC-23-verification-watchdog',
]

// Helper: extract short scenario name from abs path or short name
const name = (scn) => scn.split('/').filter(Boolean).pop()
const range = (n) => Array.from({ length: n }, (_, i) => i)

// ============================================================
// STEP 0 — Load file-based run-config (before arg resolution)
// ============================================================
phase('Config')
const fileConfigRaw = await agent(
  `Check if the file "${ROOT}/evals/runner/run-config.json" exists on disk. ` +
  `If it exists, read it (use the Read tool or run: cat "${ROOT}/evals/runner/run-config.json") ` +
  `and return ONLY the raw JSON text of the file, nothing else. ` +
  `If it does not exist, return only the string "MISS".`,
  { label: 'load run-config.json', phase: 'Config' }
)
let fileConfig = {}
if (fileConfigRaw && fileConfigRaw.trim() !== 'MISS') {
  try {
    fileConfig = JSON.parse(fileConfigRaw.trim())
  } catch (e) {
    throw new Error(`evals/runner/run-config.json parse error: ${e.message} — fix or remove the file before launching.`)
  }
}

// ============================================================
// STEP 1 — Resolve effective config: defaults <- file <- args (args win)
// ============================================================
const DEFAULT_N = 3  // safe low default; prevents accidental large burns
const AGENT_CEILING = 120  // hard cap: refuse run unless confirmLargeRun: true

const effectiveConfig = {
  samples:           (args != null && args.samples           != null) ? args.samples           : (fileConfig.samples           != null ? fileConfig.samples           : DEFAULT_N),
  samplesByScenario: (args != null && args.samplesByScenario != null) ? args.samplesByScenario : (fileConfig.samplesByScenario != null ? fileConfig.samplesByScenario : {}),
  skillDir:          (args != null && args.skillDir          != null) ? args.skillDir          : (fileConfig.skillDir          != null ? fileConfig.skillDir          : `${ROOT}/skill`),
  useCachedRed:      (args != null && args.useCachedRed      != null) ? args.useCachedRed      : (fileConfig.useCachedRed      != null ? fileConfig.useCachedRed      : false),
  agentModel:        (args != null && args.agentModel        != null) ? args.agentModel        : (fileConfig.agentModel        != null ? fileConfig.agentModel        : 'sonnet'),
  judgeModel:        (args != null && args.judgeModel        != null) ? args.judgeModel        : (fileConfig.judgeModel        != null ? fileConfig.judgeModel        : 'haiku'),
  confirmLargeRun:   (args != null && args.confirmLargeRun   != null) ? args.confirmLargeRun   : (fileConfig.confirmLargeRun   != null ? fileConfig.confirmLargeRun   : false),
}

// SCENARIOS — REQUIRED. Never defaults to ALL_SCENARIOS.
const rawScenarios =
  (args != null && args.scenarios && args.scenarios.length > 0) ? args.scenarios :
  (fileConfig.scenarios && fileConfig.scenarios.length > 0)     ? fileConfig.scenarios :
  null

if (!rawScenarios || rawScenarios.length === 0) {
  throw new Error(
    'refusing to run: no explicit scenarios configured — ' +
    'set "scenarios" in evals/runner/run-config.json or pass args.scenarios. ' +
    'The runner NEVER falls back to all ' + ALL_SCENARIOS.length + ' scenarios. ' +
    'To run all, copy ALL_SCENARIOS into your config explicitly.'
  )
}

// Resolve short names (e.g. "SC-01-duplicate-race") to absolute paths
const SCENARIOS = rawScenarios.map((s) =>
  s.startsWith('/') ? s : `${ROOT}/evals/scenarios/${s}`
)

const N = effectiveConfig.samples
const SAMPLES_BY_SCENARIO = effectiveConfig.samplesByScenario
const SKILL_DIR = effectiveConfig.skillDir
const USE_CACHED_RED = !!effectiveConfig.useCachedRed
const AGENT_MODEL = effectiveConfig.agentModel
const JUDGE_MODEL = effectiveConfig.judgeModel
const CONFIRM_LARGE_RUN = !!effectiveConfig.confirmLargeRun

// ============================================================
// STEP 2 — Agent-count ceiling guard (before ANY agent is spawned for eval)
// ============================================================
// Conservative estimate per scenario:
//   RED (not cached): N_red agents + 1 batch judge + 1 cache-write agent
//   RED (cached):     1 cache-check agent
//   GREEN:            N_green agents + 1 batch judge
// Plus 1 scorecard agent.
let expectedAgents = 0
for (const scn of SCENARIOS) {
  const scnName = name(scn)
  const scenN = SAMPLES_BY_SCENARIO[scnName] != null ? SAMPLES_BY_SCENARIO[scnName] : N
  if (USE_CACHED_RED) {
    expectedAgents += 1  // cache-check only
  } else {
    expectedAgents += scenN + 1 + 1  // N red answers + 1 batch judge + 1 cache-write
  }
  expectedAgents += scenN + 1  // N green answers + 1 batch judge
}
expectedAgents += 1  // scorecard synth

if (expectedAgents > AGENT_CEILING && !CONFIRM_LARGE_RUN) {
  throw new Error(
    `refusing to run: expectedAgents≈${expectedAgents} exceeds the safety ceiling of ${AGENT_CEILING}. ` +
    `Set "confirmLargeRun": true in run-config.json or args to override. ` +
    `(${SCENARIOS.length} scenario(s) × N=${N} + overhead. ` +
    `Per-scenario overrides: ${JSON.stringify(SAMPLES_BY_SCENARIO)})`
  )
}

// ============================================================
// STEP 3 — Startup log (visible immediately, before parallel fan-out)
// ============================================================
log('=== RESOLVED RUN CONFIG ===')
log(`scenarios (${SCENARIOS.length}): ${SCENARIOS.map(name).join(', ')}`)
log(`N (default): ${N}${Object.keys(SAMPLES_BY_SCENARIO).length > 0 ? ' | per-scenario overrides: ' + JSON.stringify(SAMPLES_BY_SCENARIO) : ''}`)
log(`useCachedRed: ${USE_CACHED_RED} | agentModel: ${AGENT_MODEL} | judgeModel: ${JUDGE_MODEL}`)
log(`expectedAgents≈${expectedAgents} (ceiling ${AGENT_CEILING}${CONFIRM_LARGE_RUN ? ', BYPASSED via confirmLargeRun' : ''})`)
log('===========================')

// ============================================================
// Schemas
// ============================================================
const DECISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { next_action: { type: 'string' }, rationale: { type: 'string' } },
  required: ['next_action', 'rationale'],
}

// Batched verdict schema: one judge call per arm returns an array of N verdicts.
// Drops judge call count from 2N to 2 per scenario.
const BATCH_VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          verdict: { type: 'string', enum: ['pass', 'fail'] },
          anti_patterns_triggered: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string' },
        },
        required: ['verdict', 'anti_patterns_triggered', 'reasoning'],
      },
    },
  },
  required: ['verdicts'],
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

// ============================================================
// Prompts
// ============================================================
const redPrompt = (scn, i) => `You are acting as the ORCHESTRATOR of a multi-agent software-delivery run (you coordinate workers; you do not do the delivery yourself). Read the situation at ${scn}/prompt.md — that file is your ONLY reference. Do NOT read any skill files, references, or other docs. Independently (variation ${i}) decide your SINGLE next action. Output next_action (concrete: the exact tool call, message, or wait you would do next) and rationale.`

const greenPrompt = (scn, i) => `You are acting as the ORCHESTRATOR of a multi-agent software-delivery run (you coordinate workers; you do not do the delivery yourself). FIRST read the skill at ${SKILL_DIR}/SKILL.md and consult ${SKILL_DIR}/references/ as needed. THEN read the situation at ${scn}/prompt.md. Apply the skill. Independently (variation ${i}) decide your SINGLE next action. Output next_action (concrete: the exact tool call, message, or wait you would do next) and rationale.`

// Batched judge prompt: receives ALL answers for one arm and returns one verdict per answer.
const batchJudgePrompt = (scn, arm, answers) => {
  const numbered = answers.map((a, i) =>
    `[${i}] next_action: ${a.next_action}\n\nrationale: ${a.rationale}`
  ).join('\n\n---\n\n')
  return `You are a STRICT eval judge. Read the rubric at ${scn}/rubric.md (PASS criteria, FAIL/anti-patterns, judge guidance). You will judge ${answers.length} ${arm}-arm answer(s). Apply the rubric strictly to EACH answer: 'pass' only if it meets ALL pass criteria and triggers NO anti-pattern; otherwise 'fail'. Return a 'verdicts' array with EXACTLY ${answers.length} element(s) in the same order as the answers below.\n\nAnswers:\n${numbered}`
}

const rate = (vs) => { const c = vs.filter(Boolean); return c.length ? c.filter((v) => v.verdict === 'pass').length / c.length : null }

// ============================================================
// Per-scenario runner
// ============================================================
async function runScenario(scn) {
  const scnName = name(scn)
  const scenarioN = SAMPLES_BY_SCENARIO[scnName] != null ? SAMPLES_BY_SCENARIO[scnName] : N

  // --- RED arm (possibly loaded from baseline cache) ---
  let redV = null
  if (USE_CACHED_RED) {
    const cachePath = `${ROOT}/evals/baselines/${scnName}.json`
    const cached = await agent(
      `Check if the file "${cachePath}" exists on disk. If it exists, read it (use the Read tool or run: cat "${cachePath}") and return its exact text contents. If it does not exist, return only the string "MISS".`,
      { label: `load RED cache ${scnName}`, phase: 'RED (no skill)' }
    )
    if (cached && cached.trim() !== 'MISS') {
      try { redV = JSON.parse(cached) } catch (_) { redV = null }
    }
  }

  if (!redV) {
    // Run RED arm fresh
    const red = await parallel(range(scenarioN).map((i) => () =>
      agent(redPrompt(scn, i), { label: `RED ${scnName} #${i}`, phase: 'RED (no skill)', schema: DECISION_SCHEMA, model: AGENT_MODEL })))
    const validRed = red.filter(Boolean)
    if (validRed.length > 0) {
      const batchResult = await agent(
        batchJudgePrompt(scn, 'RED', validRed),
        { label: `judge RED ${scnName}`, phase: 'Judge', schema: BATCH_VERDICT_SCHEMA, model: JUDGE_MODEL }
      )
      redV = batchResult ? batchResult.verdicts : []
    } else {
      redV = []
    }
    // Write baseline cache (always, so a future run with useCachedRed=true can skip this arm)
    const baseline = JSON.stringify(redV, null, 2)
    await agent(
      `Create the directory "${ROOT}/evals/baselines" if it does not exist, then write the following JSON to "${ROOT}/evals/baselines/${scnName}.json":\n\n${baseline}\n\nReturn only "ok".`,
      { label: `write RED cache ${scnName}`, phase: 'RED (no skill)' }
    )
  }

  // --- GREEN arm (always runs) ---
  const green = await parallel(range(scenarioN).map((i) => () =>
    agent(greenPrompt(scn, i), { label: `GREEN ${scnName} #${i}`, phase: 'GREEN (with skill)', schema: DECISION_SCHEMA, model: AGENT_MODEL })))
  const validGreen = green.filter(Boolean)
  let greenV = []
  if (validGreen.length > 0) {
    const batchResult = await agent(
      batchJudgePrompt(scn, 'GREEN', validGreen),
      { label: `judge GREEN ${scnName}`, phase: 'Judge', schema: BATCH_VERDICT_SCHEMA, model: JUDGE_MODEL }
    )
    greenV = batchResult ? batchResult.verdicts : []
  }

  return {
    scenario: scnName,
    n: scenarioN,
    red_pass_rate: rate(redV),
    green_pass_rate: rate(greenV),
    green_fail_antipatterns: greenV.filter(Boolean).filter((v) => v.verdict === 'fail').flatMap((v) => v.anti_patterns_triggered),
  }
}

// ============================================================
// Fan-out + scorecard
// ============================================================
phase('RED (no skill)')
log(`Starting two-arm eval: ${SCENARIOS.length} scenario(s), N=${N}, useCachedRed=${USE_CACHED_RED}, agentModel=${AGENT_MODEL}, judgeModel=${JUDGE_MODEL}.`)
const results = (await parallel(SCENARIOS.map((scn) => () => runScenario(scn)))).filter(Boolean)

phase('Scorecard')
const synth = await agent(
  `Write a scorecard for the orchestrating-delivery-agents skill eval. First run \`date +%F-%H%M\` (Bash) for a timestamp. Then WRITE the scorecard to ${ROOT}/evals/results/<timestamp>-scorecard.md (create dirs if needed; the timestamp keeps same-day runs from overwriting) containing: a header with the timestamp and N; a table with columns scenario | N | RED pass-rate | GREEN pass-rate | delta | verdict (verdict = PASS if GREEN>=0.8 AND GREEN>RED; GUARD if GREEN>=0.8 AND RED>=GREEN i.e. skill holds but scenario does not discriminate; FAIL/REVIEW if GREEN<0.8 — a real skill gap); sort so any GREEN<0.8 are at the top; a 3-5 sentence summary; and for every GREEN<0.8 scenario list the GREEN anti-patterns that fired so they can be fixed in the skill. Note in the summary that pass-rates are estimates at N=${N} (small-sample noise). Clean markdown; write the word "section", never the section glyph. Data:\n${JSON.stringify(results, null, 2)}\nReturn scorecard_file (the path you wrote), summary, and weak_scenarios (names with GREEN<0.8).`,
  { label: 'scorecard', phase: 'Scorecard', schema: SCORECARD_SCHEMA, model: JUDGE_MODEL })

return { results, scorecard: synth }
