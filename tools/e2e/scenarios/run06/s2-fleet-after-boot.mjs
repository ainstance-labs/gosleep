// s2-fleet-after-boot.mjs — Fleet screen AFTER dev-agent has launched (session should appear).
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/fleet');
await page.waitForTimeout(1500);
await screenshot(page, 's2-fleet-after-boot');
await teardown(browser, ctx);
console.log('s2: OK');
