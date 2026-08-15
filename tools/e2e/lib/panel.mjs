// tools/e2e/lib/panel.mjs
// Shared Playwright helper for gosleep-panel scenario drivers.
//
// Idempotent: every step script opens a fresh Chromium context (backed by the
// storage-state file so the Bearer + sessionStorage seeded on the first nav
// persist), navigates, does its thing, screenshots, saves storage-state, closes.
//
// Env (defaults are correct for e2e-run06):
//   GOSLEEP_CORE_URL     http://127.0.0.1:7347
//   GOSLEEP_BEARER       e2e-run06-bearer-DO-NOT-USE
//   PANEL_STORAGE_STATE  <artifacts>/panel-storage.json
//   PANEL_SHOTS_DIR      <report-runs-06>/screenshots
//
// Public API:
//   await openPanel(path?)        → { browser, ctx, page }; returns page navigated to path
//   await screenshot(page, name)  → saves PANEL_SHOTS_DIR/name.png (full page)
//   await teardown(browser, ctx)
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const CORE_URL = process.env.GOSLEEP_CORE_URL || 'http://127.0.0.1:7347';
export const BEARER = process.env.GOSLEEP_BEARER || 'e2e-run06-bearer-DO-NOT-USE';
export const STORAGE_STATE = process.env.PANEL_STORAGE_STATE
  || resolve(process.cwd(), '../.artifacts/e2e-run06/panel-storage.json');
export const SHOTS_DIR = process.env.PANEL_SHOTS_DIR
  || resolve(process.cwd(), '../../docs/reports/verifications/web-e2e-2026-08-10/runs/06/screenshots');

export async function openPanel(path = '/') {
  await mkdir(SHOTS_DIR, { recursive: true });
  await mkdir(dirname(STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctxOpts = { viewport: { width: 1440, height: 900 } };
  // NOTE: Playwright's storageState persists cookies + localStorage but NOT sessionStorage,
  // and the panel deliberately stores the Bearer only in sessionStorage. So we ALWAYS
  // seed via ?token= URL lane on the first nav of every script run.
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();

  // Seed nav: root + ?token= — auth.ts lifts the token into sessionStorage on first read.
  const seedUrl = `${CORE_URL}/?token=${encodeURIComponent(BEARER)}`;
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Now go to the requested screen (sessionStorage.gosleep.token is set → API calls authenticate).
  if (path && path !== '/') {
    const target = new URL(path, CORE_URL).toString();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(1200);
  }
  return { browser, ctx, page };
}

export async function screenshot(page, name) {
  const p = resolve(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

export async function saveState(ctx) {
  await ctx.storageState({ path: STORAGE_STATE });
}

export async function teardown(browser, ctx) {
  try { if (ctx) await saveState(ctx); } catch { /* first-run no state */ }
  await browser.close();
}
