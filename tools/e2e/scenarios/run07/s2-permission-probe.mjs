// s2-permission-probe.mjs — FIX-A probe: post one permission-kind question to the
// scratch core, screenshot the panel Questions screen showing the command text
// (FIX-A), then decide allow. Ends the "session".
//
// The core wire path is identical to what the shim posts on behalf of a live
// non-bypass claude session — the panel rendering path is the same, so this
// probe is a faithful capture of FIX-A behaviour.
import { openPanel, screenshot, teardown, CORE_URL, BEARER } from '../../lib/panel.mjs';

const INTERNAL_SECRET = process.env.GOSLEEP_INTERNAL_SECRET || 'e2e-run07-internal-secret';
const SESSION_ID = 'e2e-run07-probe-session';
const TOOL_USE_ID = `probe-${Date.now()}`;
const PROBE_COMMAND = 'grep -R "TODO" ./ | head -50';

// 1. Post first so the row already exists when the panel loads.
const postBody = {
  session_id: SESSION_ID,
  tool_use_id: TOOL_USE_ID,
  tool_name: 'PermissionRequest',
  tool_input: {
    tool: 'Bash',
    params: { command: PROBE_COMMAND },
    message: 'run07 FIX-A probe — this text must be visible on the panel card',
  },
};

console.log('[s2] posting permission-shaped question to core…');
const postRes = await fetch(`${CORE_URL}/internal/permissions/post`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Host': `127.0.0.1:${new URL(CORE_URL).port}`,
    'Origin': CORE_URL,
    'X-Internal-Secret': INTERNAL_SECRET,
  },
  body: JSON.stringify(postBody),
});
const postText = await postRes.text();
console.log(`[s2] core /internal/permissions/post → ${postRes.status} ${postText}`);
if (!postRes.ok) throw new Error(`post failed ${postRes.status}: ${postText}`);
const { qid } = JSON.parse(postText);
console.log(`[s2] qid=${qid}`);

// Give the tail indexer time to fold the row into the panel view.
await new Promise((r) => setTimeout(r, 1200));

// 2. Open the panel Questions screen.
const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(2000);
await screenshot(page, 's2a-questions-list');

// Look for command text on the page.
const commandVisible = await page.getByText(PROBE_COMMAND, { exact: false }).count().catch(() => 0);
console.log(`[s2] command-text-on-page: ${commandVisible}`);

// Find and open the answer dialog on the row.
try {
  const answerBtn = page.getByRole('button', { name: /answer|decide|allow|deny/i }).first();
  await answerBtn.click({ timeout: 5000 });
  await page.waitForTimeout(900);
  await screenshot(page, 's2b-permission-dialog-open');
  const commandInDialog = await page.getByText(PROBE_COMMAND, { exact: false }).count().catch(() => 0);
  console.log(`[s2] command-in-dialog: ${commandInDialog}`);
  // Close the dialog without deciding via UI (we decide via API below to be deterministic).
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
} catch (e) {
  console.log(`[s2] dialog open skipped: ${e?.message}`);
}

// Fallback screenshot in case dialog didn't open — capture the row anyway.
await screenshot(page, 's2c-permission-card-fix-a');

// 3. Decide via API — allow (mimicking owner clicking Allow).
const decideRes = await fetch(`${CORE_URL}/actions/permissions/decide`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Host': `127.0.0.1:${new URL(CORE_URL).port}`,
    'Origin': CORE_URL,
    'Authorization': `Bearer ${BEARER}`,
    'Idempotency-Key': `e2e-run07-s2-${qid}`,
  },
  body: JSON.stringify({ qid, decision: 'allow' }),
});
const decideText = await decideRes.text();
console.log(`[s2] decide allow → ${decideRes.status} ${decideText}`);

await page.waitForTimeout(1200);
await screenshot(page, 's2d-after-allow');
await teardown(browser, ctx);
console.log('s2: OK');
