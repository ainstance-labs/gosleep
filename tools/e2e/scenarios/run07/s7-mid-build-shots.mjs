// s7-mid-build-shots.mjs — Timeline (SSE events), Cost, Questions history.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const { browser, ctx, page } = await openPanel('/timeline');
await page.waitForTimeout(1800);
await screenshot(page, 's7a-timeline');

await page.goto(new URL('/cost', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(1500);
await screenshot(page, 's7b-cost');

await page.goto(new URL('/questions', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(1500);
await screenshot(page, 's7c-questions-both-answered');

// Also grab Tasks and Fleet at the same moment.
await page.goto(new URL('/tasks', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(1500);
await screenshot(page, 's7d-tasks-mid');

await page.goto(new URL('/fleet', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(1500);
await screenshot(page, 's7e-fleet-mid');

await teardown(browser, ctx);
console.log('s7: OK');
