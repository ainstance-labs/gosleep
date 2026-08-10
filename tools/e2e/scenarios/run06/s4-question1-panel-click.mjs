// s4-question1-panel-click.mjs — answer Q1 via panel (paste option label into textarea).
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';
const qid = process.argv[2];
const answerText = process.argv[3];
if (!qid || !answerText) { console.error('usage: s4… <qid> <answerText>'); process.exit(2); }

const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's4a-question1-panel-open');

// Click the card's Answer button (exact match — there are also nav+other buttons)
await page.locator('button', { hasText: /^Answer$/ }).first().click({ timeout: 8000 });
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 6000 });
await page.waitForTimeout(300);
await screenshot(page, 's4b-question1-dialog-open');

const ta = page.locator('[role="dialog"] textarea').first();
await ta.click();
await ta.fill(answerText);
await page.waitForTimeout(300);
await screenshot(page, 's4c-question1-variant-typed');

// Click "Send answer" button in the dialog footer
await page.locator('[role="dialog"] button', { hasText: 'Send answer' }).click({ timeout: 6000 });
await page.waitForTimeout(2500);
await screenshot(page, 's4d-question1-answered');

await teardown(browser, ctx);
console.log('s4: OK');
