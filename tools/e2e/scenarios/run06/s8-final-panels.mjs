// s8-final-panels.mjs — capture Tasks, Timeline, Overview after PR create.
// Also scan every screen for any element containing "pull request" or a github.com/*/pull/* link
// as S9 evidence (expect NONE — CAPABILITY GAP).
import { openPanel, screenshot, teardown } from '../../lib/panel.mjs';

const { browser, ctx, page } = await openPanel('/');
await page.waitForTimeout(1200);

const findings = {};

async function scanForPrLink(name) {
  const html = await page.content();
  const patterns = [
    /https?:\/\/github\.com\/[^"'\s<>]+\/pull\/\d+/g,
    /pull request/gi,
    /gh pr view/gi,
  ];
  findings[name] = {};
  for (const p of patterns) {
    const matches = html.match(p);
    findings[name][p.source] = matches ? matches.slice(0, 5) : [];
  }
}

for (const [path, name] of [
  ['/tasks', 's8a-tasks-after-pr'],
  ['/timeline', 's8b-timeline-after-pr'],
  ['/overview', 's8c-overview-after-pr'],
  ['/fleet', 's8d-fleet-after-pr'],
  ['/questions?status=Answered', 's8e-questions-answered'],
]) {
  try {
    await page.goto(new URL(path, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 12_000 });
    await page.waitForTimeout(1400);
    await screenshot(page, name);
    await scanForPrLink(name);
    console.log(`captured ${name}`);
  } catch (e) {
    console.error(`failed ${name}: ${e.message}`);
  }
}

// S9: Report scan findings — expected: no PR link surfaces
console.log('---S9-PR-LINK-SCAN---');
console.log(JSON.stringify(findings, null, 2));
await teardown(browser, ctx);
