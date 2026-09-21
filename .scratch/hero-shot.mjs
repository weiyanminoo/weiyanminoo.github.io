#!/usr/bin/env node
// Throwaway: one 1440x900 Home screenshot (the hero, where the shafts show)
// to a named file, so the shafts rework has a real before/after pair.
// Usage: node .scratch/hero-shot.mjs <outPath>

import { chromium } from 'playwright';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';

const PORT = 4325;
const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node .scratch/hero-shot.mjs <outPath>');
  process.exit(1);
}

const server = await startServer(PORT);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 14);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT}`);
  await context.close();
} finally {
  await browser.close();
  await stopServer(server.child);
}
