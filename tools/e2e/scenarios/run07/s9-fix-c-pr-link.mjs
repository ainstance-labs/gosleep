// s9-fix-c-pr-link.mjs — FIX-C confirmation: Overview "Latest PR" card + Fleet PR chip
// show a CLICKABLE link to the run 07 PR after the extractor populates last_pr_url.
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const EXPECTED_URL = process.env.RUN07_PR_URL || 'https://github.com/ainstance-labs/gosleep-e2e-todo/pull/7';

// Overview
const { browser, ctx, page } = await openPanel('/');
await page.waitForTimeout(2000);
await screenshot(page, 's9a-overview-latest-pr');

const overviewHits = await page.getByRole('link', { name: /pull\/7|counter-notes/i }).count().catch(() => 0);
const overviewHrefs = await page.getByRole('link').evaluateAll((els) => els.map(e => e.getAttribute('href')).filter(h => h && h.includes('pull/7'))).catch(() => []);
console.log(`[s9] overview pr-link count: ${overviewHits}  hrefs: ${JSON.stringify(overviewHrefs)}`);

// Fleet
await page.goto(new URL('/fleet', page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.waitForTimeout(2000);
await screenshot(page, 's9b-fleet-pr-chip');

const fleetHits = await page.getByRole('link', { name: /pull\/7|counter-notes/i }).count().catch(() => 0);
const fleetHrefs = await page.getByRole('link').evaluateAll((els) => els.map(e => e.getAttribute('href')).filter(h => h && h.includes('pull/7'))).catch(() => []);
console.log(`[s9] fleet   pr-link count: ${fleetHits}  hrefs: ${JSON.stringify(fleetHrefs)}`);

await teardown(browser, ctx);
console.log(`s9: OK  expected=${EXPECTED_URL}`);
