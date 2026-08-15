// s1-overview.mjs — Overview + Fleet screens BEFORE the dev-agent session starts.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/');
await screenshot(page, 's1a-overview');
// Fleet screen path
try {
  await page.goto(new URL('/fleet', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
} catch {}
await page.waitForTimeout(1200);
await screenshot(page, 's1b-fleet-before');
await teardown(browser, ctx);
console.log('s1: OK');
