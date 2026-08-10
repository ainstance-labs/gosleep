// s5-question2-freetext.mjs — answer a BLOCKER-kind question with CUSTOM FREE TEXT
// (evidence for the S5 leg of the run-06 scenario).
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const qid = process.argv[2];
const freeText = process.argv[3] || 'plain CSS, keep it under 100 lines';
if (!qid) { console.error('usage: s5… <qid> [freeText]'); process.exit(2); }

const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's5a-question2-panel-open');

// Click the FIRST "Answer" button — assumes our synthetic Q2 is the top open one.
await page.locator('button', { hasText: /^Answer$/ }).first().click({ timeout: 8000 });
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 6000 });
await page.waitForTimeout(300);
await screenshot(page, 's5b-question2-dialog-open');

await page.locator('[role="dialog"] textarea').fill(freeText);
await page.waitForTimeout(300);
await screenshot(page, 's5c-question2-freetext-typed');

await page.locator('[role="dialog"] button', { hasText: 'Send answer' }).click({ timeout: 6000 });
await page.waitForTimeout(2500);
await screenshot(page, 's5d-question2-answered');

await teardown(browser, ctx);
console.log('s5: OK');
