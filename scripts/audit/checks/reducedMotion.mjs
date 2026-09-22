// Check 5 — reduced motion. Neither Phase 5a nor 5b could verify this at
// all, so a failure here is a genuine finding about the site, not a bug in
// this harness (per the brief) — report it, do not fix src/.
//
// Two assertions:
//   1. The loop does not run: two full-viewport screenshots ~1s apart, with
//      nothing scrolling, must be byte-identical. Counting repaints this way
//      (not counting rAF callbacks) matters because the harness's own
//      pacing callback fires regardless of whether the *app's* loop is
//      running — only an actual pixel diff proves nothing repainted.
//   2. The static frame is non-degenerate: something the effects draw
//      actually lands on screen. See below for where this samples and why.
//
// ---------------------------------------------------------------------
// ASSERTION 2 — re-anchored 2026-09-22 from ~0 m to ~26 m.
//
// It used to sample one horizontal line at y=450 at scroll 0 and require a
// max per-channel range > 3. That threshold was set when INTENSITY.caustics
// ran at 2.4; Phase 8 corrected that constant to 0.55, which is
// arithmetically identical to the mockup's own caustics layer
// (`globalAlpha = 0.55*lit` over trough depths 58/26/15, against our
// alpha-1 draw over TROUGH_DEPTH 55/25/15) — 2.4 was 4.4x the reference
// design and was the sole reason the water at scroll 0 on Home read
// rgb(130,195,217) instead of foam. Measured after that correction, same
// strip, same metric:
//
//   caustics 0 (absent, the floor) .. 1.0 | shipped 0.55 .. 2.0 | mockup .. 1.0
//
// One unit of 8-bit quantisation between present and absent, with the
// reference design scoring the same as our floor. No threshold fits
// between 1.0 and 2.0 with headroom, so sampling there was abandoned.
//
// The sample point was the problem, not the threshold. At ~26 m marine snow
// is gated on (snow.ts: 21 -> 31 m) and nothing else is — caustics ends at
// 12 m, shafts at 14 m, shoal spans (8,19), bubbles (5,17) — so snow is
// what this now proves renders. Re-measured there, zeroing the relevant
// intensities and rebuilding for each floor rather than estimating:
//
//   INTENSITY.snow = 0 and dither = 0 (no effects at all) ............  4
//   INTENSITY.snow = 0, dither = 0.05 (snow absent, rest as shipped) .  4
//   as shipped (snow 0.37, dither 0.05) .............................. 38
//
// Threshold 12: 3x above the floor, and the shipped value is 3.2x above
// the threshold. Reproduced exactly across rebuilds.
//
// TWO THINGS THAT MAKE THAT SEPARATION REAL, both changed here:
//
// (a) The statistic scans EVERY row of the strip, not a 50px sample. Snow
//     flecks are 1.2-4px across (snow.ts RADIUS_RANGE) and ~4 of the 70
//     particles fall in an 82px-wide strip, so a coarse row scan misses
//     them by luck — the same frame that scores 38 here scored 7 under a
//     50px scan. Per row, because the canvas gradient is
//     `createLinearGradient(0, 0, 0, height)`, vertical-only and constant
//     across x, so horizontal variation within one row cannot come from it.
//
// (b) It anchors on DEPTH, not on a scroll pixel. Snow particle positions
//     are a pure function of (depthTop, viewport) — seeds are
//     `fract(i * golden)`, never Math.random(), and `time` is 0 under
//     reduced motion — so pinning the depth makes this deterministic and
//     immune to the document getting longer when content is added. A
//     hardcoded scrollY would silently drift to a different depth.
//     lib/depthEvent.mjs is used only to FIND that scroll position; the
//     pass/fail is still a measured pixel, as everywhere else in this
//     harness.
//
// NOTE: BaseLayout.astro's `.grain` (a fixed radial wash, added 2026-09-22)
// does vary horizontally, unlike the canvas gradient — it is most of the
// floor's 4 and is why the floor is not 0. It is confined to the top ~42%
// of the viewport; the snow rows that carry the signal sit below it.
//
// If this ever fails, the question is "did the effects stop painting?" —
// which is exactly the class of bug that shipped undetected once already
// (DepthRail's readout was painted under its own scrim and every contrast
// number computed for it was a false pass). Render-level proof that
// something lands on screen is the point.

import { BASE_URL, DESKTOP_VIEWPORT } from '../lib/constants.mjs';
import { settle, collectRafTimestamps } from '../lib/wait.mjs';
import { installDepthListener, readDepth } from '../lib/depthEvent.mjs';
import { captureFrame, pixelAt } from '../lib/pixels.mjs';

const WAIT_MS = 1000;
const TARGET_METRES = 26;
const VARIATION_THRESHOLD = 12;
const MIN_CLEAR_ZONE_PX = 30;
const BISECT_STEPS = 18;

/** Max per-channel range along one horizontal row of the clear strip. */
function rowRange(frame, y, xStart, xEnd) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (let x = xStart; x <= xEnd; x += 2) {
    const rgb = pixelAt(frame, x, y);
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], rgb[c]);
      max[c] = Math.max(max[c], rgb[c]);
    }
  }
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/** The largest row range anywhere in the strip, and where it was found. */
function strongestRow(frame, xStart, xEnd, height) {
  let best = { y: 0, range: -1 };
  for (let y = 1; y < height - 1; y++) {
    const range = rowRange(frame, y, xStart, xEnd);
    if (range > best.range) best = { y, range };
  }
  return best;
}

/** Scrolls to the depth the site itself reports as `TARGET_METRES`. Depth is
 *  monotonic in scrollY, so this bisects rather than guessing a pixel. */
async function scrollToDepth(page, metres) {
  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
  let lo = 0;
  let hi = maxScroll;
  let landed = maxScroll;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = Math.round((lo + hi) / 2);
    await page.evaluate((y) => window.scrollTo(0, y), mid);
    await settle(page, 2);
    const depth = await readDepth(page);
    if (!depth) return null;
    if (depth.metres < metres) lo = mid;
    else {
      hi = mid;
      landed = mid;
    }
  }
  await page.evaluate((y) => window.scrollTo(0, y), landed);
  await settle(page, 4);
  return { scrollY: landed, depth: await readDepth(page) };
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
  await installDepthListener(page);

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await settle(page, 3);

    // Assertion 1 first, before anything scrolls.
    const frame1 = await captureFrame(page);
    const rafDuringWait = (await collectRafTimestamps(page, WAIT_MS)).length;
    const frame2 = await captureFrame(page);

    const identical = frame1.data.length === frame2.data.length && frame1.data.equals(frame2.data);
    lines.push(
      `loop stopped: two full-viewport captures ${WAIT_MS}ms apart, nothing scrolled — ${
        identical ? 'byte-identical (OK)' : 'DIFFERED (FAIL) — a repaint happened under reduced motion'
      } (${rafDuringWait} native rAF ticks observed during the wait, unrelated to the app's own loop)`
    );

    // Assertion 2, at ~26m where marine snow is the live effect.
    const containerRect = await page.evaluate(() => {
      const el = document.querySelector('.container');
      return el ? el.getBoundingClientRect() : null;
    });

    let nonDegenerate = false;
    if (!containerRect || DESKTOP_VIEWPORT.width - containerRect.right < MIN_CLEAR_ZONE_PX) {
      lines.push(
        `static frame non-degenerate: no DOM-text-clear horizontal margin >= ${MIN_CLEAR_ZONE_PX}px to sample — FAIL (check cannot run)`
      );
    } else {
      const landed = await scrollToDepth(page, TARGET_METRES);
      if (!landed || !landed.depth) {
        lines.push(
          'static frame non-degenerate: the site never reported a depth, so the sample point could not be located — FAIL (check cannot run)'
        );
      } else {
        const xStart = Math.ceil(containerRect.right) + 5;
        const xEnd = DESKTOP_VIEWPORT.width - 5;
        const frame = await captureFrame(page);
        const best = strongestRow(frame, xStart, xEnd, DESKTOP_VIEWPORT.height);
        nonDegenerate = best.range > VARIATION_THRESHOLD;
        lines.push(
          `static frame non-degenerate: at ${landed.depth.metres.toFixed(1)}m (scrollY ${landed.scrollY}), ` +
            `strongest of ${DESKTOP_VIEWPORT.height - 2} rows in x=[${xStart}, ${xEnd}] is ${best.range} at y=${best.y} ` +
            `(need > ${VARIATION_THRESHOLD}; floor with the effect off is 4, as shipped 38) — ${
              nonDegenerate ? 'OK' : 'FAIL — marine snow is not reaching the screen'
            }`
        );
      }
    }

    return { name, passed: identical && nonDegenerate, lines, fatal: false };
  } finally {
    await context.close();
  }
}
