// tools/e2e/scenarios/gsl-326/run.mjs — GSL-326 live-fire proof driver.
//
// Runs against a scratch core on 127.0.0.1:7352 (seeded DB under
// <worktree>/.artifacts/live-proof/). Captures screenshots for each of the
// three cosmetic fixes shipped by the epic and saves them under
// <worktree>/.artifacts/live-proof/screenshots/.
//
// Steps:
//   1. Overview EMPTY   — no session has emitted last_pr_url yet → empty-state
//                         Latest-PR card is visible (GSL-328 proof).
//   2. Fleet FRIENDLY   — 8 seeded sessions with mixed model ids render as
//                         marketing labels, sentinels pass through
//                         (GSL-327 proof).
//   3. Populate PR      — POST last_pr_url on one session via
//                         /internal/agents/tool-observed, then re-shoot:
//   3a. Overview WITH PR — Latest-PR card populated, anchor text = "#N"
//                          (GSL-329 proof on Overview).
//   3b. Fleet WITH PR    — Fleet PR chip populated, anchor text = "#N"
//                          (GSL-329 proof on Fleet).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const CORE_URL = process.env.GOSLEEP_CORE_URL || 'http://127.0.0.1:7352';
const BEARER = process.env.GOSLEEP_BEARER || 'e2e-polish-DO-NOT-USE';
const INTERNAL_SECRET = process.env.GOSLEEP_INTERNAL_SECRET || 'e2e-polish-internal';
const SHOTS_DIR =
  process.env.PANEL_SHOTS_DIR ||
  resolve(process.cwd(), '../../.artifacts/live-proof/screenshots');
const CDP_PORT = process.env.CDP_PORT || '9252';

async function screenshot(page, name) {
  await mkdir(SHOTS_DIR, { recursive: true });
  const p = resolve(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  → ${p}`);
  return p;
}

async function countLocator(page, selector) {
  try {
    return await page.locator(selector).count({ timeout: 3000 });
  } catch {
    return -1;
  }
}

async function main() {
  console.log(`[gsl-326] CORE_URL=${CORE_URL}  SHOTS_DIR=${SHOTS_DIR}`);
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(15000);

  // -----------------------------------------------------------------------
  // STEP 1 — Overview EMPTY (Latest-PR empty-state, GSL-328)
  // -----------------------------------------------------------------------
  console.log('\n[step 1] Overview — Latest-PR empty-state (GSL-328)');
  const seedUrl = `${CORE_URL}/?token=${encodeURIComponent(BEARER)}`;
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.goto(`${CORE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(2000);

  const emptyCardCount = await countLocator(page, '[data-testid="latest-pr-card-empty"]');
  const emptyLatestPrText = await countLocator(page, 'text=/No pull requests yet/');
  const emptyLatestPrTitle = await countLocator(page, 'text=/Latest PR/');
  console.log(
    `  data-testid latest-pr-card-empty count: ${emptyCardCount}  "No pull requests yet" count: ${emptyLatestPrText}  "Latest PR" title count: ${emptyLatestPrTitle}`,
  );
  await screenshot(page, 's1-overview-empty-state');

  // -----------------------------------------------------------------------
  // STEP 2 — Fleet friendly model labels (GSL-327)
  // -----------------------------------------------------------------------
  console.log('\n[step 2] Fleet — friendly model labels (GSL-327)');
  await page.goto(`${CORE_URL}/fleet`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(2000);

  const labels = {
    'Fable 5': await countLocator(page, 'text=/^Fable 5$/'),
    'Opus 4.7': await countLocator(page, 'text=/^Opus 4\\.7$/'),
    'Opus 4.8': await countLocator(page, 'text=/^Opus 4\\.8$/'),
    'Sonnet 5': await countLocator(page, 'text=/^Sonnet 5$/'),
    'Haiku 4.5': await countLocator(page, 'text=/^Haiku 4\\.5$/'),
    unknown: await countLocator(page, 'text=/^unknown$/'),
    starting: await countLocator(page, 'text=/^starting$/'),
    'Nova 9': await countLocator(page, 'text=/^Nova 9$/'),
    'raw claude-fable-5 leaked': await countLocator(page, 'text=/^claude-fable-5$/'),
  };
  console.log('  label counts on Fleet:', JSON.stringify(labels));
  await screenshot(page, 's2-fleet-friendly-labels');

  // -----------------------------------------------------------------------
  // STEP 3 — populate a PR on one session, then re-shoot both surfaces
  // -----------------------------------------------------------------------
  console.log('\n[step 3] Seed last_pr_url via /internal/agents/tool-observed');
  const prUrl = 'https://github.com/ainstance-labs/gosleep/pull/326';
  const seedRes = await page.evaluate(
    async ({ core, secret, sessionId, prUrl }) => {
      const res = await fetch(`${core}/internal/agents/tool-observed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify({
          session_id: sessionId,
          tool: 'Bash',
          ts: new Date().toISOString(),
          intent: 'seed pr for e2e-polish live-proof',
          command_preview: `gh pr view ${prUrl}`,
          pr_url: prUrl,
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    {
      core: CORE_URL,
      secret: INTERNAL_SECRET,
      sessionId: 's-fable',
      prUrl,
    },
  );
  console.log('  tool-observed:', seedRes.status, seedRes.body.slice(0, 300));

  // 1 s debounce inside the core → wait 2 s for the flush + SSE fan-out.
  await page.waitForTimeout(2500);

  // -------- 3a — Overview WITH PR --------
  console.log('\n[step 3a] Overview — populated Latest-PR (GSL-329)');
  await page.goto(`${CORE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(2000);

  const overviewPrLink = await page
    .getByTestId('latest-pr-link')
    .first()
    .innerText()
    .catch(() => '(missing)');
  const overviewPrHref = await page
    .getByTestId('latest-pr-link')
    .first()
    .getAttribute('href')
    .catch(() => '(missing)');
  console.log(`  Overview PR anchor text: "${overviewPrLink}"  href: ${overviewPrHref}`);
  await screenshot(page, 's3a-overview-with-pr-hash-label');

  // -------- 3b — Fleet WITH PR --------
  console.log('\n[step 3b] Fleet — populated PR chip (GSL-329)');
  await page.goto(`${CORE_URL}/fleet`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(2000);

  const fleetPrLink = await page
    .getByTestId('fleet-pr-link')
    .first()
    .innerText()
    .catch(() => '(missing)');
  const fleetPrHref = await page
    .getByTestId('fleet-pr-link')
    .first()
    .getAttribute('href')
    .catch(() => '(missing)');
  console.log(`  Fleet PR chip text: "${fleetPrLink}"  href: ${fleetPrHref}`);
  await screenshot(page, 's3b-fleet-with-pr-hash-label');

  // -----------------------------------------------------------------------
  await browser.close();

  // Emit a machine-readable summary JSON so the dev_history writer can pick
  // it up without re-parsing the log.
  const summary = {
    ts: '2026-08-11T00:00:00Z', // fixed literal — e2e log is what humans read for real timing
    core_url: CORE_URL,
    step1: { emptyCardCount, emptyLatestPrText, emptyLatestPrTitle },
    step2_labels: labels,
    step3a: { anchorText: overviewPrLink, href: overviewPrHref },
    step3b: { anchorText: fleetPrLink, href: fleetPrHref },
  };
  console.log('\n[summary]', JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
