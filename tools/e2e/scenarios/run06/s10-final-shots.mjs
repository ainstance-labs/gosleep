import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/fleet');
await page.waitForTimeout(1500);
await screenshot(page, 's10-fleet-final');
await page.goto('http://127.0.0.1:7347/timeline', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await screenshot(page, 's10-timeline-final');
await teardown(browser, ctx);
