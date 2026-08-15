// s10-sse.mjs — verify the panel SSE stream delivers a live update without a full reload.
// Approach: open the Overview page, capture the initial event count, subscribe to SSE via
// EventSource in the page context, wait for a message frame, screenshot with the counter changed.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/');
await page.waitForTimeout(1200);
// Inject a listener that tags the page when SSE messages arrive
await page.evaluate(() => {
  window.__sse_msgs = [];
  const token = sessionStorage.getItem('gosleep.token');
  if (!token) { window.__sse_ready = 'no-token'; return; }
  const es = new EventSource(`/sse?token=${encodeURIComponent(token)}`);
  es.onmessage = ev => window.__sse_msgs.push({ t: Date.now(), d: ev.data.slice(0, 200) });
  es.onerror = ev => window.__sse_msgs.push({ t: Date.now(), err: 'sse-error' });
  window.__sse_ready = 'ok';
});
await page.waitForTimeout(500);
const readyState = await page.evaluate(() => window.__sse_ready);
console.log('sse ready state:', readyState);
// Wait up to 20s for any SSE message
const t0 = Date.now();
let msgs = [];
while (Date.now() - t0 < 20000) {
  msgs = await page.evaluate(() => window.__sse_msgs || []);
  if (msgs.length > 0) break;
  await page.waitForTimeout(500);
}
console.log(`SSE messages received in ${Date.now()-t0}ms: ${msgs.length}`);
console.log('sample:', JSON.stringify(msgs.slice(0, 2)));
await screenshot(page, 's10-sse-after-messages');
await teardown(browser, ctx);
