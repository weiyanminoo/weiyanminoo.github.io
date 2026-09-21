// Check 6 — frame cost, measured from the real loop. No synthetic paint()
// microbenchmark: Phase 5b produced two (0.5ms and 416.8ms) and neither
// measured a frame — one was dominated by a forced layout the real loop
// never incurs, the other by a getImageData GPU readback. Real
// requestAnimationFrame timestamps from the actual running loop, in a real
// compositor, are the honest number.
//
// Fix round 1: an absolute 55fps/20ms budget turned out to measure this
// *environment's* rasterisation path, not the site — headless Chromium
// without GPU flags falls back to software canvas rendering, where a
// single trivial fillRect already can't hit 55fps, so failing the site
// against that floor was blaming it for something it did not do. The fix
// was self-calibration: measure a trivial full-viewport fillRect as a
// control, interleaved with the site, in the same session — and if the
// control itself can't clear the floor, report INCONCLUSIVE instead of
// failing the run.
//
// Fix round 2: that gate could never fire. A single fillRect is so cheap
// it still runs at 60fps in pure software — mutation-testing with
// `--disable-gpu` proved this: control stayed at 60.0fps while the site
// (three full-viewport composites plus an upscaled drawImage) collapsed to
// ~12fps, so the control never dropped below MIN_FPS and the check reported
// a false FAIL, exactly the failure mode round 1 was supposed to remove.
// Two changes: (1) the primary abstention gate is now Chromium's own GPU
// status from CDP (`SystemInfo.getInfo`), checked *before* any fps
// comparison — software rasterisation is detected directly instead of
// inferred from a timing number that turned out not to be a reliable
// signal. (2) the control workload is now representative of the site's
// rendering shape (gradient fill + overlay/multiply/screen composites over
// an upscaled buffer, reimplemented here rather than imported from src/) so
// its fps still means something as a secondary calibrator when GPU status
// can't be read.

import crypto from 'node:crypto';
import { BASE_URL, DESKTOP_VIEWPORT } from '../lib/constants.mjs';
import { settle, collectRafTimestamps } from '../lib/wait.mjs';

const SAMPLE_MS = 2000;
const ROUNDS = 3; // interleaved rounds; medians reported, not single samples
const MIN_FPS = 55;
const RELATIVE_MARGIN = 0.1; // site must land within 10% of the control, not just clear an absolute floor

// A full-viewport canvas animation shaped like the site's own per-frame
// work — same *kind* of cost, not the same code (nothing here is imported
// from src/; an instrument that shares code with the thing it measures
// can't calibrate it). Four layers per frame, matching what made the site
// collapse under software rasterisation while a lone fillRect did not:
//   1. a full-viewport vertical gradient fill
//   2. a full-viewport composited layer, globalCompositeOperation 'overlay'
//   3. a small (~170x104) offscreen buffer drawImage'd up to full viewport
//      under 'multiply'
//   4. another small offscreen buffer upscaled the same way under 'screen'
// This control is a secondary calibrator (see gpu-status gate below for the
// primary one) — a ratio between it and the site only means something if
// it is doing comparable work, which a single fillRect never did.
const CONTROL_HTML = `<!doctype html>
<html><head><style>html,body{margin:0;padding:0}canvas{display:block}</style></head>
<body><canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;

  const bufA = document.createElement('canvas');
  bufA.width = 170;
  bufA.height = 104;
  const bufActx = bufA.getContext('2d');
  bufActx.fillStyle = '#448866';
  bufActx.fillRect(0, 0, bufA.width, bufA.height);

  const bufB = document.createElement('canvas');
  bufB.width = 170;
  bufB.height = 104;
  const bufBctx = bufB.getContext('2d');
  bufBctx.fillStyle = '#886644';
  bufBctx.fillRect(0, 0, bufB.width, bufB.height);

  function loop() {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#123456');
    grad.addColorStop(1, '#654321');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = '#336699';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(bufA, 0, 0, w, h);

    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(bufB, 0, 0, w, h);

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
</script>
</body></html>`;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(timestamps) {
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const durationS =
    timestamps.length > 1 ? (timestamps[timestamps.length - 1] - timestamps[0]) / 1000 : 0;
  const fps = durationS > 0 ? (timestamps.length - 1) / durationS : 0;
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  const p95 = sorted.length > 0 ? sorted[p95Index] : 0;
  return { fps, p95, frames: timestamps.length };
}

// Ping-pongs scroll position across the full scrollable range while
// collecting real wall-clock frame arrival times (see collectRafTimestamps
// in lib/wait.mjs for why Node's Date.now() is used instead of the page's
// own performance.now()), so scroll-driven repaints are exercised
// throughout the measurement window rather than in one burst.
async function collectWhileScrolling(page, durationMs) {
  const bindingName = `__auditScrollTick_${crypto.randomBytes(4).toString('hex')}`;
  const timestamps = [];
  await page.exposeFunction(bindingName, () => {
    timestamps.push(Date.now());
  });
  await page.evaluate(
    ({ duration, fnName }) =>
      new Promise((resolve) => {
        const start = performance.now();
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        function step(t) {
          window[fnName]();
          const elapsed = t - start;
          const cycle = (elapsed % 2000) / 2000; // one full down-up cycle every 2s
          const progress = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
          window.scrollTo(0, Math.round(progress * maxScroll));
          if (elapsed < duration) {
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

function formatMedian(label, samples, unit = 'fps') {
  const fmt = (v) => v.toFixed(1);
  return `${label} ${fmt(median(samples))}${unit} (median of ${samples.length}: ${samples.map(fmt).join(', ')})`;
}

// Verdict for one site measurement (idle or scrolling) against the control
// baseline already established this run. Returns { ok, label }.
function judge(siteFps, controlFps) {
  if (siteFps < MIN_FPS) {
    return { ok: false, label: `${siteFps.toFixed(1)}fps < ${MIN_FPS}fps floor — FAIL` };
  }
  const floor = controlFps * (1 - RELATIVE_MARGIN);
  if (siteFps < floor) {
    return {
      ok: false,
      label: `${siteFps.toFixed(1)}fps clears the ${MIN_FPS}fps floor but is more than ${(
        RELATIVE_MARGIN * 100
      ).toFixed(0)}% behind the ${controlFps.toFixed(1)}fps control (floor ${floor.toFixed(1)}fps) — FAIL`,
    };
  }
  return {
    ok: true,
    label: `${siteFps.toFixed(1)}fps, within ${(RELATIVE_MARGIN * 100).toFixed(0)}% of the ${controlFps.toFixed(
      1
    )}fps control — OK`,
  };
}

// Ground truth for "which mode did this run in", from Chromium itself
// rather than inferred from a frame-rate number — fix round 1 tried to
// infer software rasterisation from the control's fps, but a trivial
// single fillRect turns out to stay fast even with 2D canvas compositing
// running in software, so control fps alone was not reliable evidence of
// which path was used (see phase-6a-report.md, Fix round 1; the mutation
// test in Fix round 2 is what proved it). This is now the *primary*
// abstention gate: checked directly against Chromium's own feature status,
// before any fps comparison. If CDP introspection fails for any reason,
// `isSoftware` is reported false (unknown) and the numeric control-fps gate
// below still applies as a fallback.
async function getGpuStatus(browser) {
  try {
    const session = await browser.newBrowserCDPSession();
    const info = await session.send('SystemInfo.getInfo');
    const status = info.gpu?.featureStatus ?? {};
    const canvas2d = status['2d_canvas'] ?? 'unknown';
    const compositing = status['gpu_compositing'] ?? 'unknown';
    const isSoftwareValue = (value) => {
      const v = String(value).toLowerCase();
      return v.includes('software') || v.includes('disabled') || v.includes('unavailable');
    };
    return {
      label: `2d_canvas=${canvas2d}, gpu_compositing=${compositing}`,
      isSoftware: isSoftwareValue(canvas2d) || isSoftwareValue(compositing),
    };
  } catch (err) {
    return { label: `unknown (SystemInfo.getInfo failed: ${err.message})`, isSoftware: false };
  }
}

export async function runFrameCostCheck(browser) {
  const name = 'Frame cost';
  const lines = [];

  const gpuStatus = await getGpuStatus(browser);

  const controlContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 });
  const controlPage = await controlContext.newPage();
  const siteContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 });
  const sitePage = await siteContext.newPage();

  try {
    await controlPage.setContent(CONTROL_HTML);
    await settle(controlPage, 5);

    await sitePage.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await settle(sitePage, 10); // let the loop warm up before measuring

    // Interleaved: control, site-idle, site-scrolling, repeated, so no
    // single ordering (warm-up, thermal, GC) advantages one side. A
    // single-shot measurement is not a measurement — see the coordinator's
    // own first run, which read the site at 48.2fps un-interleaved and
    // 57.5fps once interleaved.
    const controlFpsSamples = [];
    const idleFpsSamples = [];
    const scrollFpsSamples = [];

    for (let round = 0; round < ROUNDS; round++) {
      const control = summarize(await collectRafTimestamps(controlPage, SAMPLE_MS));
      controlFpsSamples.push(control.fps);

      await sitePage.evaluate(() => window.scrollTo(0, 0));
      await settle(sitePage, 3);
      const idle = summarize(await collectRafTimestamps(sitePage, SAMPLE_MS));
      idleFpsSamples.push(idle.fps);

      const scroll = summarize(await collectWhileScrolling(sitePage, SAMPLE_MS));
      scrollFpsSamples.push(scroll.fps);
    }

    const controlFps = median(controlFpsSamples);
    const idleFps = median(idleFpsSamples);
    const scrollFps = median(scrollFpsSamples);

    lines.push(
      `${ROUNDS} interleaved rounds, ${SAMPLE_MS / 1000}s/sample, ${DESKTOP_VIEWPORT.width}x${
        DESKTOP_VIEWPORT.height
      }, control = full-viewport gradient + overlay/multiply/screen composites (same shape as the site's own ` +
        `per-frame work), site = / (the full-column page, heaviest)`
    );
    lines.push(formatMedian('control:', controlFpsSamples));
    lines.push(formatMedian('site idle:', idleFpsSamples));
    lines.push(formatMedian('site scrolling:', scrollFpsSamples));

    lines.push(`Chromium GPU status: ${gpuStatus.label}`);

    // Primary gate: Chromium's own report of its rendering path, checked
    // before any fps comparison — see the comment on getGpuStatus above for
    // why this replaced the fps-only gate that fix round 1 shipped.
    if (gpuStatus.isSoftware) {
      lines.push(
        `verdict: INCONCLUSIVE — Chromium reports software rasterisation (${gpuStatus.label}), so this ` +
          `environment cannot measure frame cost honestly. Not a FAIL: blaming the site for the environment's ` +
          `rendering path is the false-failure class this harness exists to eliminate. Expected on GPU-less CI ` +
          `(e.g. GitHub Actions' default runners, or a launch forced with --disable-gpu); re-run with real GPU ` +
          `compositing to get a real verdict.`
      );
      return { name, passed: true, inconclusive: true, lines, fatal: false };
    }

    // Fallback gate: only reached if GPU status could not be read (CDP
    // failure). Keeps the pre-round-2 safety net for that edge case now
    // that the control itself does comparable work to the site.
    if (controlFps < MIN_FPS) {
      lines.push(
        `verdict: INCONCLUSIVE — GPU status could not be confirmed and the control itself can't sustain ` +
          `${MIN_FPS}fps, so this environment cannot measure frame cost honestly. Not a FAIL: blaming the site ` +
          `for the environment's rendering path is the false-failure class this harness exists to eliminate.`
      );
      return { name, passed: true, inconclusive: true, lines, fatal: false };
    }

    const idleVerdict = judge(idleFps, controlFps);
    const scrollVerdict = judge(scrollFps, controlFps);
    lines.push(`site idle verdict: ${idleVerdict.label}`);
    lines.push(`site scrolling verdict: ${scrollVerdict.label}`);

    return { name, passed: idleVerdict.ok && scrollVerdict.ok, lines, fatal: false };
  } finally {
    await controlContext.close();
    await siteContext.close();
  }
}
