// s7-panel-screens.mjs — Timeline, Cost, Questions history screens for evidence.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const { browser, ctx, page } = await openPanel('/');
await page.waitForTimeout(1200);

for (const [path, name] of [
  ['/timeline', 's7a-timeline'],
  ['/cost', 's7b-cost'],
  ['/questions?status=Answered', 's7c-questions-answered'],
  ['/questions', 's7d-questions-all'],
  ['/tasks', 's7e-tasks'],
  ['/fleet', 's7f-fleet-mid-run'],
  ['/overview', 's7g-overview-mid-run'],
]) {
  try {
    await page.goto(new URL(path, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 12_000 });
    await page.waitForTimeout(1400);
    await screenshot(page, name);
    console.log(`captured ${name}`);
  } catch (e) {
    console.error(`failed ${name}: ${e.message}`);
  }
}
await teardown(browser, ctx);
console.log('s7: OK');
