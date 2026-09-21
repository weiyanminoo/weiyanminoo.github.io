#!/usr/bin/env node
// Throwaway A/B instrument: worst rendered-pixel contrast for ONE selector
// on Home, using the audit's own pixel path (screenshot read, glyphs
// hidden, several time samples). Used to test whether INTENSITY.caustics is
// what bounds the hero lede — run once per build with a different caustics
// multiplier, everything else identical.
// Usage: node .scratch/hero-lede-probe.mjs "<css selector>" [label]

import { chromium } from 'playwright';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';
import { captureFrame, pixelAt, contrastRatio, parseCssColor } from '../scripts/audit/lib/pixels.mjs';

const PORT = 4326;
const SELECTOR = process.argv[2] || '.lede';
const LABEL = process.argv[3] || SELECTOR;
const GRID_STEP = 8;

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
  await settle(page, 6);

  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Snapshot BEFORE hiding the glyphs: getComputedStyle is live, so
    // reading .color after the override returns the transparent value.
    const snapshot = { top: r.top, left: r.left, width: r.width, height: r.height, color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight };
    el.style.setProperty('color', 'transparent', 'important');
    return snapshot;
  }, SELECTOR);
  if (!info) throw new Error(`selector not found: ${SELECTOR}`);

  const fg = parseCssColor(info.color);
  const points = [];
  for (let y = info.top + 2; y < info.top + info.height - 2; y += GRID_STEP) {
    for (let x = info.left + 2; x < info.left + info.width - 2; x += GRID_STEP) {
      points.push([x, y]);
    }
  }

  let worst = null;
  let sumL = 0;
  let n = 0;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await page.waitForTimeout(450);
    await settle(page, 1);
    const frame = await captureFrame(page);
    for (const [x, y] of points) {
      const bg = pixelAt(frame, x, y);
      const ratio = contrastRatio(fg, bg);
      sumL += (bg[0] + bg[1] + bg[2]) / 3;
      n += 1;
      if (!worst || ratio < worst.ratio) worst = { ratio, bg };
    }
  }
  console.log(
    `${LABEL}: ${info.fontSize}/${info.fontWeight} fg=rgb(${fg.join(',')}) worst=${worst.ratio.toFixed(3)}:1 ` +
      `worstBg=rgb(${worst.bg.map((v) => Math.round(v)).join(',')}) meanChannel=${(sumL / n).toFixed(1)} over ${points.length} pts x 6 frames`
  );
  await context.close();
} finally {
  await browser.close();
  await stopServer(server.child);
}
