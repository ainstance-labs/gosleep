// s5-q1-variant.mjs — Answer Q1 by picking one of the offered VARIANTS.
// The panel's Answer dialog is a textarea (per run06 finding) — "picking a variant"
// means typing the variant's label verbatim, as opposed to Q2 which supplies novel
// free text. This still exercises the variant-selection semantic legitimately.
import { openPanel, screenshot, teardown, CORE_URL, BEARER } from '../../lib/panel.mjs';

const QID = process.env.RUN07_Q1_QID || 'q-2026-08-10-001';
const VARIANT = process.env.RUN07_Q1_VARIANT || 'Counter + Notes + localStorage';

const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's5a-q1-questions-list');

// Click the top card's "Answer" button.
await page.locator('button', { hasText: /^Answer$/ }).first().click({ timeout: 8000 });
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 8000 });
await page.waitForTimeout(300);
await screenshot(page, 's5b-q1-dialog-open');

const ta = page.locator('[role="dialog"] textarea').first();
await ta.click();
await ta.fill(VARIANT);
await page.waitForTimeout(300);
await screenshot(page, 's5c-q1-variant-typed');

await page.locator('[role="dialog"] button', { hasText: 'Send answer' }).click({ timeout: 6000 });
await page.waitForTimeout(2500);
await screenshot(page, 's5d-q1-answered');

await teardown(browser, ctx);
console.log(`s5: OK  answered qid=${QID} variant="${VARIANT}"`);
