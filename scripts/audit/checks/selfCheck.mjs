// Check 1 — instrument self-check. Runs first and gates everything else:
// if this fails, the run aborts before any contrast/overflow/motion/frame
// number is trusted. Every failure mode this guards against is one that
// previously produced confident wrong numbers by hand (see the brief's
// "Why this exists"):
//   - a viewport reporting innerWidth === 0 while claiming to be loaded
//   - document.hidden === false while running zero rAF callbacks
//   - stale-frame sampling against a frozen rAF loop

import { BASE_URL, DESKTOP_VIEWPORT, DEEPEST_STOP_RGB } from '../lib/constants.mjs';
import { settle, collectRafTimestamps } from '../lib/wait.mjs';
import { captureFrame, pixelAt, colourDistance } from '../lib/pixels.mjs';

// This check only has to prove the loop is not stalled (the described
// failure is "document.hidden === false while running zero rAF
// callbacks") — the performance budget itself is check 6's job, at its own
// much stricter threshold. Measured on this harness's own build machine,
// the real site at 1440x900 renders around 12-14fps under headless,
// GPU-less software rasterisation (confirmed by viewport-size scaling: a
// 200x200 canvas on the same page holds a clean 60fps, so the drop is
// raster-bound, not a stalled loop) — so this floor stays well below any
// legitimate slow-but-alive rate while still catching an actually-stalled
// loop.
const MIN_PLAUSIBLE_FPS = 5;
const FRESHNESS_MIN_DISTANCE = 40; // top (foam, ~rgb 246) vs bottom (abyss, ~rgb 11) must clearly differ
const DEEPEST_TOLERANCE = 40; // per-pixel tolerance for dither/effects noise on the bottom sample
const CLEAR_X_OFFSET = 40; // px in from the right edge — clear of body text and the (left-side) depth rail
const CLEAR_Y_MARGIN = 40; // px in from top/bottom of viewport

export async function runSelfCheck(browser) {
  const name = 'Instrument self-check';
  const lines = [];
  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await settle(page, 5);

    // 1. The viewport is real.
    const viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      hidden: document.hidden,
    }));
    const viewportOk =
      viewport.innerWidth > 0 &&
      viewport.innerHeight > 0 &&
      Math.abs(viewport.innerWidth - DESKTOP_VIEWPORT.width) <= 20 &&
      Math.abs(viewport.innerHeight - DESKTOP_VIEWPORT.height) <= 20;
    lines.push(
      `viewport real: ${viewport.innerWidth}x${viewport.innerHeight} (requested ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}), ` +
        `document.hidden=${viewport.hidden} — ${viewportOk ? 'OK' : 'FAIL'}`
    );

    // 2. The rAF loop actually runs, at a plausible rate.
    const rafTimestamps = await collectRafTimestamps(page, 1000);
    const measuredFrames = rafTimestamps.length;
    const rafOk = measuredFrames >= MIN_PLAUSIBLE_FPS;
    lines.push(
      `rAF loop runs: ${measuredFrames} frames in ~1s (need >= ${MIN_PLAUSIBLE_FPS}) — ${rafOk ? 'OK' : 'FAIL'}`
    );

    // 3. Canvas reads are fresh, not stale: sample at scroll-top, scroll to
    // the bottom, sample again, require the two to differ, and require the
    // bottom to read close to the 32m stop-table value.
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page, 5);
    const topFrame = await captureFrame(page);
    const sampleX = DESKTOP_VIEWPORT.width - CLEAR_X_OFFSET;
    const topPixel = pixelAt(topFrame, sampleX, CLEAR_Y_MARGIN + 40);

    const maxScroll = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight
    );
    await page.evaluate((y) => window.scrollTo(0, y), maxScroll);
    await settle(page, 5);
    const bottomFrame = await captureFrame(page);
    const bottomPixel = pixelAt(bottomFrame, sampleX, DESKTOP_VIEWPORT.height - CLEAR_Y_MARGIN);

    const distance = colourDistance(topPixel, bottomPixel);
    const freshOk = distance >= FRESHNESS_MIN_DISTANCE;
    lines.push(
      `canvas reads fresh: top rgb(${topPixel.join(', ')}) vs bottom rgb(${bottomPixel.join(', ')}), ` +
        `distance ${distance.toFixed(1)} (need >= ${FRESHNESS_MIN_DISTANCE}) — ${freshOk ? 'OK' : 'FAIL'}`
    );

    const deepDistance = colourDistance(bottomPixel, DEEPEST_STOP_RGB);
    const deepOk = deepDistance <= DEEPEST_TOLERANCE;
    lines.push(
      `bottom-of-Home close to 32m stop: measured rgb(${bottomPixel.join(', ')}) vs stop rgb(${DEEPEST_STOP_RGB.join(
        ', '
      )}), distance ${deepDistance.toFixed(1)} (need <= ${DEEPEST_TOLERANCE}) — ${deepOk ? 'OK' : 'FAIL'}`
    );

    const passed = viewportOk && rafOk && freshOk && deepOk;
    if (!passed) {
      lines.push('ABORTING: the instrument itself did not verify. No further checks will run.');
    }
    return { name, passed, lines, fatal: !passed };
  } finally {
    await context.close();
  }
}
