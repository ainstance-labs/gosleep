// s6a-permission-deny.mjs — DENY the top open permission card (opens dialog, confirms deny).
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const denyReason = process.argv[2] || 'e2e-run06: testing deny leg via panel';

const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's6a-permission-cards');

// Click Deny on the FIRST open permission card
await page.locator('button', { hasText: /^Deny$/ }).first().click({ timeout: 8000 });
// Wait for the deny dialog textarea (autoFocused) to appear
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 6000 });
await page.waitForTimeout(300);
await screenshot(page, 's6b-deny-dialog-open');

// Type reason
await page.locator('[role="dialog"] textarea').fill(denyReason);
await page.waitForTimeout(300);
await screenshot(page, 's6c-deny-reason-typed');

// Confirm — the dialog's solid Deny button
await page.locator('[role="dialog"] button', { hasText: /^Deny$/ }).click({ timeout: 6000 });
await page.waitForTimeout(2500);
await screenshot(page, 's6d-after-deny-confirmed');

await teardown(browser, ctx);
console.log('s6a: OK');
