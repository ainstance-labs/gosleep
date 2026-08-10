// s6-q2-freetext.mjs — Answer Q2 with genuine free text that is NOT one of the
// offered variants. Different from S5 where we picked an existing option label.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const QID = process.env.RUN07_Q2_QID || 'q-2026-08-10-002';
const FREETEXT = process.env.RUN07_Q2_FREETEXT
  || 'Обычный CSS с CSS-переменными и коротким reset — минимум зависимостей, без CSS-in-JS. Тёмная тема через prefers-color-scheme, размеры в rem.';

const { browser, ctx, page } = await openPanel('/questions');
await page.waitForTimeout(1500);
await screenshot(page, 's6a-q2-questions-list');

// Click Answer for the top OPEN card (Q2 should be top).
await page.locator('button', { hasText: /^Answer$/ }).first().click({ timeout: 8000 });
await page.locator('[role="dialog"] textarea').waitFor({ timeout: 8000 });
await page.waitForTimeout(300);
await screenshot(page, 's6b-q2-dialog-open');

const ta = page.locator('[role="dialog"] textarea').first();
await ta.click();
await ta.fill(FREETEXT);
await page.waitForTimeout(300);
await screenshot(page, 's6c-q2-freetext-typed');

await page.locator('[role="dialog"] button', { hasText: 'Send answer' }).click({ timeout: 6000 });
await page.waitForTimeout(2500);
await screenshot(page, 's6d-q2-answered');

await teardown(browser, ctx);
console.log(`s6: OK  answered qid=${QID} freetext-len=${FREETEXT.length}`);
