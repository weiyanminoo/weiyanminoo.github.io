#!/usr/bin/env node
// Captures the phase-7 screenshot set via a real Playwright screenshot
// against `astro preview` over dist/ (must be built first) — same
// instrument the audit itself uses (scripts/audit/lib/pixels.mjs), chosen
// deliberately over the interactive Browser pane, which was returning
// stale/blank captures in this session despite the canvas itself painting
// correctly (verified via direct canvas.getImageData reads) — a pane
// visibility issue, not a site bug, but not a trustworthy screenshot source
// either way.

import { chromium } from 'playwright';
import path from 'node:path';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';

const PORT = 4324;
const OUT_DIR = process.argv[2] || '.scratch/shots';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
const PAGES = [
  ['/', 'home'],
  ['/work', 'work'],
  ['/projects', 'projects'],
  ['/outside', 'outside'],
];

async function shootPage(browser, viewport, pathName, outPath) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}${pathName}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 12);
  await page.screenshot({ path: outPath });
  await context.close();
}

async function shootHomeScroll(browser, fraction, outPath) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 6);
  await page.evaluate((f) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(max * f));
  }, fraction);
  await settle(page, 8);
  await page.screenshot({ path: outPath });
  await context.close();
}

async function main() {
  console.log(`Building? (assumes dist/ already built) Starting preview on ${PORT}...`);
  const server = await startServer(PORT);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    for (const [pathName, slug] of PAGES) {
      const desktopOut = path.join(OUT_DIR, `${slug}-1440x900.png`);
      const mobileOut = path.join(OUT_DIR, `${slug}-375x812.png`);
      await shootPage(browser, DESKTOP, pathName, desktopOut);
      console.log(`wrote ${desktopOut}`);
      await shootPage(browser, MOBILE, pathName, mobileOut);
      console.log(`wrote ${mobileOut}`);
    }

    await shootHomeScroll(browser, 0, path.join(OUT_DIR, 'home-scroll-surface.png'));
    console.log('wrote home-scroll-surface.png');
    await shootHomeScroll(browser, 0.5, path.join(OUT_DIR, 'home-scroll-midwater.png'));
    console.log('wrote home-scroll-midwater.png');
    await shootHomeScroll(browser, 1, path.join(OUT_DIR, 'home-scroll-deep.png'));
    console.log('wrote home-scroll-deep.png');
  } finally {
    await browser.close();
    await stopServer(server.child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
