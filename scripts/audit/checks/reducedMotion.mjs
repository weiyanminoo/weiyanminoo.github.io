// Check 5 — reduced motion. With `prefers-reduced-motion: reduce` the dive
// must not run at all (spec §11): no camera motion, no autoplaying video,
// a still behind each section instead.
//
// Two assertions:
//   1. Nothing repaints: two full-viewport screenshots ~1s apart, with
//      nothing scrolling, must be byte-identical. Counting repaints this way
//      (not counting rAF callbacks) matters because the harness's own
//      pacing callback fires regardless of whether the *app's* loop is
//      running — only an actual pixel diff proves nothing repainted.
//   2. The film is replaced, not just stopped: html.has-dive is never set,
//      every station's still has loaded and is displayed (scrolling through
//      so lazy ones fetch), and no <video> is playing.
//
// (Until 2026-10 assertion 2 sampled marine snow on the old 2D water canvas
// at ~26 m; that canvas no longer exists.)

import { BASE_URL, DESKTOP_VIEWPORT } from '../lib/constants.mjs';
import { settle, collectRafTimestamps } from '../lib/wait.mjs';
import { captureFrame } from '../lib/pixels.mjs';

const WAIT_MS = 1000;
const STATIONS = 7;

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

    // Assertion 1 first, before anything scrolls.
    const frame1 = await captureFrame(page);
    const rafDuringWait = (await collectRafTimestamps(page, WAIT_MS)).length;
    const frame2 = await captureFrame(page);

    const identical = frame1.data.length === frame2.data.length && frame1.data.equals(frame2.data);
    lines.push(
      `nothing repaints: two full-viewport captures ${WAIT_MS}ms apart, nothing scrolled — ${
        identical ? 'byte-identical (OK)' : 'DIFFERED (FAIL) — a repaint happened under reduced motion'
      } (${rafDuringWait} native rAF ticks observed during the wait, unrelated to the app's own loop)`
    );

    // Assertion 2.
    const hasDive = await page.evaluate(() => document.documentElement.classList.contains('has-dive'));
    await page.evaluate(async () => {
      for (const el of document.querySelectorAll('.station')) {
        el.scrollIntoView();
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const stills = await page.evaluate(() =>
      [...document.querySelectorAll('.station .still')].map(
        (img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== 'none',
      ),
    );
    const playing = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length);
    const stillsOk = stills.length === STATIONS && stills.every(Boolean);
    const replaced = !hasDive && stillsOk && playing === 0;
    lines.push(
      `film replaced by stills: has-dive=${hasDive}, stills loaded ${stills.filter(Boolean).length}/${STATIONS}, ` +
        `videos playing=${playing} — ${replaced ? 'OK' : 'FAIL'}`
    );

    return { name, passed: identical && replaced, lines, fatal: false };
  } finally {
    await context.close();
  }
}
