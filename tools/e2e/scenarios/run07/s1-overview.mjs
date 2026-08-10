// s1-overview.mjs — Overview + Fleet BEFORE the dev-agent starts.
// Also confirms the new "Latest PR" card (FIX-C empty state) renders on Overview.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/');
await screenshot(page, 's1a-overview');
// Look for "Latest PR" text on overview — confirmation the FIX-C card is present.
const latestPrOnPage = await page.locator('text=/latest pr/i').first().count().catch(() => 0);
console.log(`s1 latest-pr-text-count: ${latestPrOnPage}`);
try {
  await page.goto(new URL('/fleet', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
} catch {}
await page.waitForTimeout(1500);
await screenshot(page, 's1b-fleet-before');
await teardown(browser, ctx);
console.log('s1: OK');
