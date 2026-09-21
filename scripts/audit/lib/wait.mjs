// Waiting on the real rAF loop, never on a fixed timeout standing in for
// one. A `setTimeout` guess is exactly the kind of stale-frame sampling
// that produced false failures before this harness existed.

import crypto from 'node:crypto';

/** Resolves after `frames` real animation frames have elapsed in the page. */
export async function settle(page, frames = 2) {
  await page.evaluate((n) => {
    return new Promise((resolve) => {
      let count = 0;
      function step() {
        count += 1;
        if (count >= n) {
          resolve(undefined);
        } else {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    });
  }, frames);
}

/**
 * Runs a counting requestAnimationFrame loop in-page for `durationMs` and
 * returns every callback's real wall-clock arrival time (Node's Date.now(),
 * not the page's own performance.now()). This is the one counter used
 * everywhere a frame rate or frame interval is reported — self-check and
 * frame-cost both call this, so the self-check is verifying the exact
 * mechanism the other checks depend on.
 *
 * Why not just return performance.now() timestamps from a single
 * page.evaluate(), the obvious approach: measured on this harness's own
 * target environment, that approach silently underreports. A bare in-page
 * rAF loop with no outbound traffic saw real per-frame gaps of ~100ms+
 * while each callback's *own* performance.now() delta still read a smooth
 * ~16.7ms — Chromium's frame timestamps tracked an idealised 60Hz cadence,
 * not when the callback actually ran, so a naive
 * `frames / ((last-first)/1000)` computed a confident ~60fps against a
 * loop that was really landing around 9 real frames/sec. That is exactly
 * the "two frame-cost numbers, neither of which measured a frame" failure
 * mode this harness exists to catch, just discovered in its own
 * instrument instead of the site's. Calling back out to Node once per
 * frame (via exposeFunction, fire-and-forget so it never blocks the rAF
 * loop's own pacing) and timestamping on arrival with Date.now() measures
 * real wall-clock delivery instead, and was verified against a plain
 * requestAnimationFrame loop to recover a genuine, consistent ~60fps.
 */
export async function collectRafTimestamps(page, durationMs) {
  const bindingName = `__auditTick_${crypto.randomBytes(4).toString('hex')}`;
  const timestamps = [];
  await page.exposeFunction(bindingName, () => {
    timestamps.push(Date.now());
  });
  await page.evaluate(
    ({ duration, fnName }) =>
      new Promise((resolve) => {
        const start = performance.now();
        function step(t) {
          window[fnName]();
          if (t - start < duration) {
            requestAnimationFrame(step);
          } else {
            resolve(undefined);
          }
        }
        requestAnimationFrame(step);
      }),
    { duration: durationMs, fnName: bindingName }
  );
  return timestamps;
}
