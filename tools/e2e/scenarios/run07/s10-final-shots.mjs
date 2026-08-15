// s10-final-shots.mjs — wind-down shots: Fleet + Timeline with the PR link + sonnet model.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const { browser, ctx, page } = await openPanel('/fleet');
await page.waitForTimeout(2000);
await screenshot(page, 's10a-fleet-final');

await page.goto(new URL('/timeline', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(2000);
await screenshot(page, 's10b-timeline-final');

await page.goto(new URL('/', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(2000);
await screenshot(page, 's10c-overview-final');

await teardown(browser, ctx);
console.log('s10: OK');
