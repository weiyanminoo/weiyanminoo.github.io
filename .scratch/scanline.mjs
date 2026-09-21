#!/usr/bin/env node
// Ad-hoc measurement: horizontal scanline variation near the top of Home,
// sampled the same way scripts/audit/checks/reducedMotion.mjs does (real
// Playwright screenshot -> decoded RGBA -> per-channel min/max along a
// horizontal line, in an x-range clear of DOM text so only the canvas'
// caustics/shafts/dither show up). Used for the phase-7 "before/after"
// caustics-vs-shafts report, per the brief's instruction to measure it the
// same way both times. Not part of the audit harness; reads scripts/audit's
// lib modules but writes nothing there.

import { chromium } from 'playwright';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { captureFrame, pixelAt } from '../scripts/audit/lib/pixels.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';

const PORT = 4323; // different from the real audit's 4322, so this never fights it
const VIEWPORT = { width: 1440, height: 900 };
const Y = 80; // one fixed horizontal line, near the top of Home (just below the header), where shafts/caustics gate strongest

function horizontalVariation(frame, y, xStart, xEnd) {
  let minC = [Infinity, Infinity, Infinity];
  let maxC = [-Infinity, -Infinity, -Infinity];
  for (let x = xStart; x <= xEnd; x += 1) {
    const rgb = pixelAt(frame, x, y);
    for (let c = 0; c < 3; c++) {
      minC[c] = Math.min(minC[c], rgb[c]);
      maxC[c] = Math.max(maxC[c], rgb[c]);
    }
  }
  return [maxC[0] - minC[0], maxC[1] - minC[1], maxC[2] - minC[2]];
}

async function main() {
  console.log('Building and starting preview server...');
  const server = await startServer(PORT);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 10);

    const containerRect = await page.evaluate(() => {
      const el = document.querySelector('.container');
      return el ? el.getBoundingClientRect() : null;
    });
    const xStart = Math.ceil(containerRect.right) + 5;
    const xEnd = VIEWPORT.width - 5;
    console.log(`clear x-range: [${xStart}, ${xEnd}] (container right edge ${containerRect.right.toFixed(1)})`);

    // Same fixed horizontal line (y=80), 6 independent time samples 300ms
    // apart with the real loop running throughout — same
    // settle()-then-capture pattern contrast.mjs uses, so this isn't a
    // stale-frame read. Reports every sample, not just one, so a lucky flat
    // instant can't stand in for the whole picture.
    const ranges = [];
    for (let i = 0; i < 6; i++) {
      await settle(page, 3);
      const frame = await captureFrame(page);
      const range = horizontalVariation(frame, Y, xStart, xEnd);
      ranges.push(range);
      await page.waitForTimeout(300);
    }

    for (const [i, range] of ranges.entries()) {
      console.log(
        `  sample ${i}: rgb(${range.map((v) => v.toFixed(1)).join(', ')}) max=${Math.max(...range).toFixed(1)}`
      );
    }
    const maxima = ranges.map((r) => Math.max(...r));
    console.log(
      `y=${Y}, x=[${xStart}, ${xEnd}]: max-channel-range across 6 samples: min=${Math.min(...maxima).toFixed(1)}, max=${Math.max(...maxima).toFixed(1)}, avg=${(maxima.reduce((a, b) => a + b, 0) / maxima.length).toFixed(1)}`
    );

    await context.close();
  } finally {
    await browser.close();
    await stopServer(server.child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
