// s6b-permission-allow.mjs — ALLOW the top open permission from the panel.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's6e-allow-card-open');

// Click Allow — Allow is immediate (no dialog per Questions.tsx: "sends immediately").
await page.locator('button', { hasText: /^Allow$/ }).first().click({ timeout: 8000 });
await page.waitForTimeout(2500);
await screenshot(page, 's6f-after-allow');
await teardown(browser, ctx);
console.log('s6b: OK');
