#!/usr/bin/env node
// `npm run audit` entry point. Assumes dist/ is already built (the `audit`
// npm script chains `astro build && node scripts/audit/index.mjs`) — this
// file's own job is: serve dist/, drive real headless Chromium, run every
// check, print a readable report, and exit non-zero if anything failed or
// could not be measured.
//
// Governing rule (see phase-6a-brief.md "Why this exists"): the instrument
// self-check runs first and gates everything else. A false pass is worse
// than no check at all.

import { chromium } from 'playwright';
import { PREVIEW_PORT } from './lib/constants.mjs';
import { startServer, stopServer } from './lib/server.mjs';
import { printCheckResult, printSummary } from './lib/report.mjs';
import { runSelfCheck } from './checks/selfCheck.mjs';
import { runContrastCheck } from './checks/contrast.mjs';
import { runOverflowCheck } from './checks/overflow.mjs';
import { runNoJsCheck } from './checks/noJs.mjs';
import { runReducedMotionCheck } from './checks/reducedMotion.mjs';
import { runFrameCostCheck } from './checks/frameCost.mjs';

const injectContrastFailure = process.env.AUDIT_INJECT_CONTRAST_FAILURE === '1';

async function main() {
  console.log(`Starting astro preview on port ${PREVIEW_PORT}...`);
  const server = await startServer(PREVIEW_PORT);
  let browser;

  try {
    try {
      // GPU enabled where available: the frame-cost check's control
      // baseline (checks/frameCost.mjs) is what actually detects whether
      // this launch got real hardware compositing or fell back to
      // software rasterisation, and reports honestly either way — these
      // flags just give it the best chance of a real GPU when one exists,
      // rather than silently measuring headless Chromium's own software
      // fallback (~5-19fps on a full-viewport canvas, unrelated to the
      // site) and blaming it on the site.
      browser = await chromium.launch({
        headless: true,
        args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
      });
    } catch (err) {
      console.error(
        '\nFailed to launch Playwright\'s bundled Chromium.\n' +
          "If this is a fresh checkout or CI runner, run the one-time browser install:\n" +
          '  npx playwright install chromium\n\n' +
          `Original error: ${err.message}`
      );
      process.exitCode = 1;
      return;
    }

    console.log('Chromium launched. Running instrument self-check...');
    const results = [];

    const selfCheck = await runSelfCheck(browser);
    printCheckResult(selfCheck);
    results.push(selfCheck);

    if (!selfCheck.passed) {
      console.error(
        '\nInstrument self-check failed — aborting before any further measurement is trusted.'
      );
      process.exitCode = printSummary(results);
      return;
    }

    if (injectContrastFailure) {
      console.log('\n(AUDIT_INJECT_CONTRAST_FAILURE=1 — planting a deliberate low-contrast probe element)');
    }

    const checks = [
      () => runContrastCheck(browser, { injectFailure: injectContrastFailure }),
      () => runOverflowCheck(browser),
      () => runNoJsCheck(browser),
      () => runReducedMotionCheck(browser),
      () => runFrameCostCheck(browser),
    ];

    for (const run of checks) {
      const result = await run();
      printCheckResult(result);
      results.push(result);
    }

    process.exitCode = printSummary(results);
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopServer(server.child);
  }
}

main().catch((err) => {
  console.error('\nAudit harness crashed unexpectedly:');
  console.error(err);
  process.exitCode = 1;
});
