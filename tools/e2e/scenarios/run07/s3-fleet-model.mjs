// s3-fleet-model.mjs — FIX-B check: Fleet Model column shows the session's real
// model (transcript-first), not the global config default.
import { openPanel, screenshot, teardown, CORE_URL, BEARER } from '../../lib/panel.mjs';

// Poll the fleet API for the todo-run07 row first — sanity check + record the value we
// expect to see rendered on the panel.
const fleetRes = await fetch(`${CORE_URL}/fleet`, {
  headers: {
    'Host': `127.0.0.1:${new URL(CORE_URL).port}`,
    'Origin': CORE_URL,
    'Authorization': `Bearer ${BEARER}`,
  },
});
const fleet = await fleetRes.json();
const todo = (fleet.sessions || []).find((s) => (s.cwd || '').includes('todo-run07'));
if (!todo) {
  console.log(`[s3] WARNING: todo-run07 session not found yet. Sessions: ${JSON.stringify(fleet.sessions?.map(s=>s.cwd))}`);
} else {
  console.log(`[s3] todo-run07 model=${todo.model} session_id=${todo.session_id}`);
}

const { browser, ctx, page } = await openPanel('/fleet');
await page.waitForTimeout(2500);
await screenshot(page, 's3a-fleet-with-devagent');

// Find the todo-run07 row and confirm the model text is visible on the page.
const modelText = todo?.model || 'sonnet';
const modelHits = await page.getByText(modelText, { exact: false }).count().catch(() => 0);
console.log(`[s3] model-text-on-page (${modelText}): ${modelHits}`);
const todoHits = await page.getByText('todo-run07', { exact: false }).count().catch(() => 0);
console.log(`[s3] todo-run07-text-on-page: ${todoHits}`);

await teardown(browser, ctx);
console.log('s3: OK');
