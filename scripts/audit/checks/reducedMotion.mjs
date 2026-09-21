// Check 5 — reduced motion. Neither Phase 5a nor 5b could verify this at
// all, so a failure here is a genuine finding about the site, not a bug in
// this harness (per the brief) — report it, do not fix src/.
//
// Two independent assertions:
//   1. The loop does not run: two full-viewport screenshots ~1s apart, with
//      nothing scrolling, must be byte-identical. Counting repaints this way
//      (not counting rAF callbacks) matters because the harness's own
//      pacing callback fires regardless of whether the *app's* loop is
//      running — only an actual pixel diff proves nothing repainted.
//   2. The static frame is non-degenerate: sampled along a horizontal line
//      at fixed y, in a margin clear of any DOM text. The canvas gradient is
//      built with `ctx.createLinearGradient(0, 0, 0, height)` — vertical
//      only, by construction constant across x — so any variation found
//      along that horizontal line cannot come from the gradient. It can
//      only be dither/caustics/shafts/snow/shoal/bubbles, which is exactly
//      what distinguishes "the effects render a real static frame" from
//      "only the flat gradient renders."

import { BASE_URL, DESKTOP_VIEWPORT } from '../lib/constants.mjs';
import { settle, collectRafTimestamps } from '../lib/wait.mjs';
import { captureFrame, pixelAt } from '../lib/pixels.mjs';

const WAIT_MS = 1000;
const VARIATION_THRESHOLD = 3; // max-min per channel along the clear horizontal line
const MIN_CLEAR_ZONE_PX = 30;

function horizontalVariation(frame, y, xStart, xEnd) {
  let minC = [Infinity, Infinity, Infinity];
  let maxC = [-Infinity, -Infinity, -Infinity];
  const samples = [];
  for (let x = xStart; x <= xEnd; x += 2) {
    const rgb = pixelAt(frame, x, y);
    samples.push(rgb);
    for (let c = 0; c < 3; c++) {
      minC[c] = Math.min(minC[c], rgb[c]);
      maxC[c] = Math.max(maxC[c], rgb[c]);
    }
  }
  const range = [maxC[0] - minC[0], maxC[1] - minC[1], maxC[2] - minC[2]];
  return { range, maxRange: Math.max(...range), sampleCount: samples.length };
}

export async function runReducedMotionCheck(browser) {
  const name = 'Reduced motion';
  const lines = [];

  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await settle(page, 3);

    const frame1 = await captureFrame(page);
    const rafDuringWait = (await collectRafTimestamps(page, WAIT_MS)).length;
    const frame2 = await captureFrame(page);

    const identical = frame1.data.length === frame2.data.length && frame1.data.equals(frame2.data);
    lines.push(
      `loop stopped: two full-viewport captures ${WAIT_MS}ms apart, nothing scrolled — ${
        identical ? 'byte-identical (OK)' : 'DIFFERED (FAIL) — a repaint happened under reduced motion'
      } (${rafDuringWait} native rAF ticks observed during the wait, unrelated to the app's own loop)`
    );

    const containerRect = await page.evaluate(() => {
      const el = document.querySelector('.container');
      return el ? el.getBoundingClientRect() : null;
    });

    let clearXStart = null;
    let clearXEnd = null;
    if (containerRect && DESKTOP_VIEWPORT.width - containerRect.right >= MIN_CLEAR_ZONE_PX) {
      clearXStart = Math.ceil(containerRect.right) + 5;
      clearXEnd = DESKTOP_VIEWPORT.width - 5;
    }

    let nonDegenerate = false;
    if (clearXStart !== null) {
      const y = Math.round(DESKTOP_VIEWPORT.height / 2);
      const { range, maxRange, sampleCount } = horizontalVariation(frame2, y, clearXStart, clearXEnd);
      nonDegenerate = maxRange > VARIATION_THRESHOLD;
      lines.push(
        `static frame non-degenerate: horizontal line at y=${y}, x=[${clearXStart}, ${clearXEnd}] (clear of DOM text, ` +
          `where the vertical-only gradient is constant by construction), ${sampleCount} points, per-channel range rgb(${range
            .map((r) => r.toFixed(1))
            .join(', ')}) — max ${maxRange.toFixed(1)} (need > ${VARIATION_THRESHOLD}, i.e. effects rendering, not just the gradient) — ${
          nonDegenerate ? 'OK' : 'FAIL'
        }`
      );
    } else {
      lines.push(
        `static frame non-degenerate: could not find a DOM-text-clear horizontal margin >= ${MIN_CLEAR_ZONE_PX}px wide to sample — FAIL (check cannot run)`
      );
    }

    const passed = identical && nonDegenerate;
    return { name, passed, lines, fatal: false };
  } finally {
    await context.close();
  }
}
