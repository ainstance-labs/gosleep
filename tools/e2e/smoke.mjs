// gosleep-e2e — smoke script.
//
// Purpose: prove Playwright + chromium are usable from this standalone package.
// Runtime: pick whichever works (`bun smoke.mjs` first, fall back to `node smoke.mjs`).
// Emits a screenshot at ./.smoke.png that the caller is expected to delete after
// verifying — this file is not for repeatable diagnostics, just for a one-shot
// "does the toolchain actually run" check.

import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const OUT = new URL('./.smoke.png', import.meta.url);

async function main() {
  const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`[smoke] runtime = ${runtime}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('data:text/html,<h1>ok</h1>');

  const text = await page.locator('h1').innerText();
  await page.screenshot({ path: OUT.pathname });
  await browser.close();

  if (text.trim() !== 'ok') {
    throw new Error(`H1 text mismatch: got "${text}", expected "ok"`);
  }
  if (!existsSync(OUT.pathname)) {
    throw new Error(`screenshot not written to ${OUT.pathname}`);
  }
  console.log(`[smoke] OK — H1="${text}" screenshot=${OUT.pathname}`);
}

main().catch((err) => {
  console.error(`[smoke] FAIL: ${err?.stack ?? err}`);
  process.exit(1);
});
