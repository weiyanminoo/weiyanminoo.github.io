#!/usr/bin/env node
// Review harness for the dive. Serves the built dist/, seeks the scene to
// exact frames through window.__dive (only exposed under ?review), and
// writes what a reviewer looks at into .scratch/dive-review/round-N/:
// contact sheets per shot at desktop and phone size, and transition strips
// across every cut. It also runs the checks that guard the render contract
// (spec §5) and exits non-zero if any fails:
//
//   determinism   the same (progress, time) twice gives identical pixels
//   order         a frame does not depend on the frames seeked before it
//   resize        rotating a phone mid-dive keeps sections on their depth
//   context-loss  a lost WebGL context drops back to the stills
//   early-context-loss  one lost during the warm-up still ends the mount
//
// Flags: --round N  --strips  --stills (write public/dive/stills/*.jpg)
//        --flash (entry-burst flash check, added with the bubbles)
//
// Assumes `npm run build` has already produced dist/.

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../audit/lib/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const PORT = 4325;
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
// Mid-exhale (breathAt(8).phase ≈ 0.61), so sheets show the rising bubbles.
const TIME_S = 8;
const SHOT_SAMPLES = [0.25, 0.5, 0.75];
// Every move in the dive: the reef rising out of the blue on the descent,
// arriving over the crest, going over the edge, the manta's and the
// shark's passes, and the thermocline.
const STRIP_CENTRES = [0.2, 0.3, 0.5, 0.62, 0.69, 0.74];
const STRIP_HALF_WIDTH = 0.02;
const STRIP_FRAMES = 12;
const DEPTH_TOLERANCE_M = 0.5;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const round = (() => {
  const i = args.indexOf('--round');
  return i >= 0 ? args[i + 1] : '0';
})();
const outDir = path.join(repoRoot, '.scratch', 'dive-review', `round-${round}`);

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok    ${msg}`);

// Until --stills has been run once, the poster frames do not exist yet, so
// a 404 for one is expected rather than a failure.
const stillsExist = await fs
  .access(path.join(repoRoot, 'public', 'dive', 'stills', 'work.jpg'))
  .then(() => true)
  .catch(() => false);

async function openPage(browser, viewport, query) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Network failures are reported by URL from the response listener; the
  // console's own "Failed to load resource" line carries no URL.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (!stillsExist && r.url().includes('/dive/stills/')) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  await page.addInitScript(() => {
    window.addEventListener('dive:depth', (e) => {
      window.__lastDepth = e.detail.metres;
    });
  });
  await page.goto(`${BASE}/${query ? `?${query}` : ''}`, { waitUntil: 'load' });
  return { context, page, errors };
}

async function openReview(browser, viewport, query = 'review&notext') {
  const opened = await openPage(browser, viewport, query);
  await opened.page.waitForFunction(() => !!window.__dive, null, { timeout: 20000 });
  return opened;
}

async function frame(page, progress, timeS, entry = 1, type = 'png') {
  await page.evaluate(([p, t, e]) => window.__dive.seek(p, t, e), [progress, timeS, entry]);
  return page.screenshot(type === 'jpeg' ? { type, quality: 80 } : { type });
}

/** Lays images out in a grid by rendering an HTML page of them and
 *  screenshotting it — no image-processing dependency needed. */
async function tile(browser, images, labels, cols, cellWidth, outPath) {
  // A one-pixel viewport so the full-page screenshot is exactly the grid.
  const context = await browser.newContext({
    viewport: { width: cols * cellWidth, height: 1 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const cells = images
    .map(
      (buf, i) =>
        `<figure><img src="data:image/jpeg;base64,${buf.toString('base64')}"><figcaption>${labels[i]}</figcaption></figure>`,
    )
    .join('');
  await page.setContent(
    `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${cellWidth}px)}` +
      `figure{margin:0;position:relative}img{width:100%;display:block}` +
      `figcaption{position:absolute;left:4px;top:4px;font:11px monospace;color:#fff;background:#000a;padding:1px 4px}</style>${cells}`,
  );
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.screenshot({ path: outPath, fullPage: true });
  await context.close();
}

async function contactSheets(browser) {
  for (const [name, viewport, cellWidth] of [
    ['desktop', DESKTOP, 320],
    ['mobile', MOBILE, 150],
  ]) {
    const { context, page, errors } = await openReview(browser, viewport);
    const shots = await page.evaluate(() => window.__dive.shots);
    const images = [];
    const labels = [];
    for (const s of shots) {
      for (const k of SHOT_SAMPLES) {
        const p = s.from + (s.to - s.from) * k;
        images.push(await frame(page, p, TIME_S, 1, 'jpeg'));
        labels.push(`${s.id} ${p.toFixed(3)}`);
      }
    }
    const out = path.join(outDir, `contact-${name}.png`);
    await tile(browser, images, labels, 6, cellWidth, out);
    if (errors.length) fail(`contact-${name}: page errors: ${errors.join(' | ')}`);
    else ok(`contact-${name}.png (${images.length} frames)`);
    await context.close();
  }
}

async function strips(browser) {
  const { context, page, errors } = await openReview(browser, DESKTOP);
  for (const c of STRIP_CENTRES) {
    const images = [];
    const labels = [];
    for (let i = 0; i < STRIP_FRAMES; i++) {
      const p = c - STRIP_HALF_WIDTH + ((2 * STRIP_HALF_WIDTH) * i) / (STRIP_FRAMES - 1);
      images.push(await frame(page, p, TIME_S, 1, 'jpeg'));
      labels.push(p.toFixed(3));
    }
    await tile(browser, images, labels, STRIP_FRAMES, 240, path.join(outDir, `strip-${c.toFixed(2)}.png`));
  }
  const images = [];
  const labels = [];
  for (let i = 0; i < STRIP_FRAMES; i++) {
    const e = i / (STRIP_FRAMES - 1);
    images.push(await frame(page, 0, TIME_S, e, 'jpeg'));
    labels.push(`entry ${e.toFixed(2)}`);
  }
  await tile(browser, images, labels, STRIP_FRAMES, 240, path.join(outDir, 'strip-entry.png'));
  if (errors.length) fail(`strips: page errors: ${errors.join(' | ')}`);
  else ok(`strips (${STRIP_CENTRES.length} cuts + entry)`);
  await context.close();
}

async function determinism(browser) {
  const a = await openReview(browser, DESKTOP);
  const first = sha(await frame(a.page, 0.4, TIME_S));
  const second = sha(await frame(a.page, 0.4, TIME_S));
  if (first === second) ok('determinism: seek(0.4, 10) twice is pixel-identical');
  else fail('determinism: seek(0.4, 10) twice gave different pixels');

  // Review Focus 2: a jump lands on exactly the frame a slow scroll would.
  await frame(a.page, 0.1, 3);
  const afterOther = sha(await frame(a.page, 0.9, TIME_S));
  await a.context.close();
  const b = await openReview(browser, DESKTOP);
  const fresh = sha(await frame(b.page, 0.9, TIME_S));
  await b.context.close();
  if (afterOther === fresh) ok('order: seek(0.9) is the same frame fresh or after seek(0.1)');
  else fail('order: seek(0.9) depends on the frame before it');
}

async function resizeCheck(browser) {
  // Review Focus 1, in live mode: rotate a phone with #work on screen.
  const { context, page, errors } = await openPage(browser, MOBILE, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('has-dive'));
  const expected = await (async () => {
    const r = await openReview(browser, DESKTOP);
    const d = await r.page.evaluate(() => window.__dive.stateAt(window.__dive.sections.work).depth);
    await r.context.close();
    return d;
  })();
  await page.evaluate(() => document.getElementById('work').scrollIntoView({ block: 'center' }));
  await page.setViewportSize({ width: MOBILE.height, height: MOBILE.width });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('work').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1000);
  const depth = await page.evaluate(() => window.__lastDepth);
  if (typeof depth === 'number' && Math.abs(depth - expected) <= DEPTH_TOLERANCE_M) {
    ok(`resize: #work after rotation reads ${depth.toFixed(1)} m (expected ${expected.toFixed(1)})`);
  } else {
    fail(`resize: #work after rotation reads ${depth} m, expected ${expected.toFixed(1)} ± ${DEPTH_TOLERANCE_M}`);
  }
  if (errors.length) fail(`resize: page errors: ${errors.join(' | ')}`);
  await context.close();
}

async function contextLossCheck(browser) {
  // Review Focus 4: the GPU resets mid-dive.
  const { context, page, errors } = await openPage(browser, DESKTOP, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('has-dive'));
  await page.evaluate(() => document.getElementById('work').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const gl = document.getElementById('dive-canvas').getContext('webgl2');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => ({
    hasDive: document.documentElement.classList.contains('has-dive'),
    stillDisplay: getComputedStyle(document.querySelector('#work .still')).display,
  }));
  if (!result.hasDive && result.stillDisplay !== 'none') ok('context-loss: fell back to the stills');
  else fail(`context-loss: has-dive=${result.hasDive}, #work still display=${result.stillDisplay}`);
  if (errors.length) fail(`context-loss: page errors: ${errors.join(' | ')}`);
  await context.close();
}

// The GPU context is lost during the pre-roll, before the film is shown.
// The mount must still end — on the stills, compact layout — with Dive in
// working (renderer.compileAsync once waited for ever here, and the
// controls were only wired after the mount).
async function earlyContextLossCheck(browser) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let done = false;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const gl = original.call(this, type, ...rest);
      if (!done && gl && type === 'webgl2' && this.id === 'dive-canvas') {
        done = true;
        setTimeout(() => gl.getExtension('WEBGL_lose_context')?.loseContext(), 0);
      }
      return gl;
    };
  });
  await page.goto(`${BASE}/?notext`, { waitUntil: 'load' });
  const ended = await page
    .waitForFunction(() => !document.documentElement.classList.contains('dive-js'), null, { timeout: 8000 })
    .then(() => true, () => false);
  const result = await page.evaluate(() => ({
    hasDive: document.documentElement.classList.contains('has-dive'),
    stillDisplay: getComputedStyle(document.querySelector('#work .still')).display,
  }));
  await page.click('.dive-in');
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.id ?? '');
  if (ended && !result.hasDive && result.stillDisplay !== 'none' && focused === 'about') {
    ok('early-context-loss: the mount ended on the stills, Dive in reached #about');
  } else {
    fail(
      `early-context-loss: mount ended=${ended}, has-dive=${result.hasDive}, ` +
        `#work still display=${result.stillDisplay}, focus after Dive in=${focused || 'none'}`,
    );
  }
  if (errors.length) fail(`early-context-loss: page errors: ${errors.join(' | ')}`);
  await context.close();
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function meanLuminance(buf) {
  const png = PNG.sync.read(buf);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < png.height; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      const i = (y * png.width + x) * 4;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]].map((v) => srgbToLinear(v / 255));
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  return sum / count;
}

// WCAG 2.3.1: nothing flashes more than three times a second. The entry
// burst is the one time-driven sequence (1.2 s, sampled at 60 fps); a flash
// is a pair of opposing luminance swings each larger than 10% of the peak.
async function flashCheck(browser) {
  const { context, page } = await openReview(browser, DESKTOP);
  const samples = 72;
  const lum = [];
  for (let i = 0; i < samples; i++) {
    const e = i / (samples - 1);
    lum.push(meanLuminance(await frame(page, 0, TIME_S + e * 1.2, e)));
  }
  await context.close();
  const threshold = 0.1 * Math.max(...lum);
  let swings = 0;
  let dir = 0;
  let extreme = lum[0];
  for (const v of lum) {
    if (dir >= 0) {
      if (v > extreme) extreme = v;
      else if (extreme - v > threshold) [swings, dir, extreme] = [swings + 1, -1, v];
    } else if (v < extreme) extreme = v;
    else if (v - extreme > threshold) [swings, dir, extreme] = [swings + 1, 1, v];
  }
  const flashes = swings / 2;
  if (flashes <= 3) ok(`flash: entry burst has ${flashes} flash(es) in 1.2 s`);
  else fail(`flash: entry burst has ${flashes} flashes in 1.2 s (limit 3/s)`);
}

// Dive in and Surface from the keyboard (plan Task 16).
async function keyboardCheck(browser) {
  const { context, page, errors } = await openPage(browser, DESKTOP, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('has-dive'));
  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.classList.contains('dive-in') ?? false);
  }
  if (!reached) fail('keyboard: Dive in not reachable with Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  const afterDive = await page.evaluate(() => ({
    focus: document.activeElement?.id,
    gauge: Number(document.querySelector('[data-depth]')?.textContent),
    gaugeShown: !document.querySelector('.depth-gauge')?.hidden,
  }));
  if (afterDive.focus === 'about' && afterDive.gaugeShown && afterDive.gauge >= 6 && afterDive.gauge <= 9) {
    ok(`keyboard: Dive in reached #about, gauge ${afterDive.gauge} m`);
  } else {
    fail(`keyboard: after Dive in focus=${afterDive.focus}, gauge=${afterDive.gauge} (shown ${afterDive.gaugeShown}); want #about, 6–9 m`);
  }
  await page.focus('.surface');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  const afterSurface = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    focus: document.activeElement?.className ?? '',
  }));
  if (afterSurface.y === 0 && afterSurface.focus.includes('title-h1')) ok('keyboard: Surface returned to the top, focus on the title');
  else fail(`keyboard: after Surface scrollY=${afterSurface.y}, focus=${afterSurface.focus}`);
  if (errors.length) fail(`keyboard: page errors: ${errors.join(' | ')}`);
  await context.close();
}

// Review Focus 5: sound survives the tab going to the background (iOS
// suspends the AudioContext), and a mute choice survives a reload.
async function soundCheck(browser) {
  const { context, page, errors } = await openPage(browser, DESKTOP, 'review');
  await page.waitForFunction(() => !!window.__diveAudio);
  await page.click('.dive-in');
  await page.waitForTimeout(500);
  const started = await page.evaluate(() => window.__diveAudio.context?.state);
  await page.evaluate(async () => {
    await window.__diveAudio.context.suspend();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  const resumed = await page.evaluate(() => window.__diveAudio.context?.state);
  if (started === 'running' && resumed === 'running') ok('sound: starts on Dive in and resumes after a suspension');
  else fail(`sound: state after Dive in ${started}, after resume ${resumed}`);

  await page.click('.sound-toggle');
  const stored = await page.evaluate(() => window.localStorage.getItem('dive:muted'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__diveAudio);
  await page.click('.dive-in');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    muted: window.__diveAudio.muted,
    pressed: document.querySelector('.sound-toggle')?.getAttribute('aria-pressed'),
  }));
  if (stored === 'true' && after.muted && after.pressed === 'false') ok('sound: mute is remembered across a reload');
  else fail(`sound: stored=${stored}, after reload muted=${after.muted} aria-pressed=${after.pressed}`);
  if (errors.length) fail(`sound: page errors: ${errors.join(' | ')}`);
  await context.close();
}

// Renders 60 s of the mix at 20 m offline in the page and measures its
// integrated loudness with ffmpeg's EBU R128 meter (target ≈ −16 LUFS).
async function loudness(browser) {
  const { context, page } = await openReview(browser, DESKTOP, 'review');
  await page.waitForFunction(() => !!window.__diveAudioPreview);
  const b64 = await page.evaluate(async () => {
    const buf = await window.__diveAudioPreview(60, 20);
    const n = buf.length;
    const view = new DataView(new ArrayBuffer(44 + n * 4));
    const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + n * 4, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, buf.sampleRate, true);
    view.setUint32(28, buf.sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, n * 4, true);
    const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
    for (let i = 0; i < n; i++) {
      view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
      view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
    }
    const bytes = new Uint8Array(view.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await context.close();
  const wav = path.join(outDir, 'mix-20m.wav');
  await fs.writeFile(wav, Buffer.from(b64, 'base64'));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const match = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop() ?? '');
  if (match) ok(`loudness: ${match[1]} LUFS integrated at 20 m (target −16)`);
  else fail(`loudness: could not read ffmpeg ebur128 output`);
}

// Every station's still has loaded (scrolling through so lazy ones fetch).
async function stillsLoaded(page) {
  await page.evaluate(async () => {
    for (const el of document.querySelectorAll('.station')) {
      el.scrollIntoView();
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  return page.evaluate(() =>
    [...document.querySelectorAll('.still')].every(
      (img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== 'none',
    ),
  );
}

// Reduced motion (plan Task 19): no film, the stills instead, no video,
// and nothing moving.
async function reducedMotionCheck(browser) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const hasDive = await page.evaluate(() => document.documentElement.classList.contains('has-dive'));
  const stills = await stillsLoaded(page);
  const playing = await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused));
  const a = sha(await page.screenshot());
  await page.waitForTimeout(1000);
  const b = sha(await page.screenshot());
  if (!hasDive && stills && !playing && a === b) ok('reduced-motion: stills shown, no film, no video, nothing moving');
  else fail(`reduced-motion: has-dive=${hasDive}, stills loaded=${stills}, video playing=${playing}, static=${a === b}`);
  if (errors.length) fail(`reduced-motion: page errors: ${errors.join(' | ')}`);
  await context.close();
}

// No WebGL at all: the stills, and no errors.
async function noWebglCheck() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-3d-apis', '--disable-webgl'] });
  try {
    const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const hasDive = await page.evaluate(() => document.documentElement.classList.contains('has-dive'));
    const stills = await stillsLoaded(page);
    if (!hasDive && stills) ok('no-webgl: stills shown');
    else fail(`no-webgl: has-dive=${hasDive}, stills loaded=${stills}`);
    if (errors.length) fail(`no-webgl: page errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
  }
}

// Scrolling back into a school must not stall (frame-cost audit, Task 20):
// on ANGLE/D3D11 the instanced fish's first draw after a gap stalled the
// GPU 100–230 ms. Oscillates the live page across the snapper school's
// window edge (progress 0.6, ≈20.86 m) and fails on any frame over 80 ms
// after a warm-up pass.
async function stallCheck(browser) {
  const { context, page, errors } = await openPage(browser, DESKTOP, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('has-dive'));
  let lo = 0;
  let hi = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let i = 0; i < 18; i++) {
    const mid = Math.round((lo + hi) / 2);
    await page.evaluate((y) => window.scrollTo(0, y), mid);
    await page.waitForTimeout(120);
    if ((await page.evaluate(() => window.__lastDepth)) < 20.86) lo = mid;
    else hi = mid;
  }
  const oscillate = () =>
    page.evaluate(
      (centre) =>
        new Promise((resolve) => {
          const times = [];
          const start = performance.now();
          function step(t) {
            times.push(t);
            const e = t - start;
            window.scrollTo(0, Math.round(centre + 60 * Math.sin((e / 1000) * Math.PI * 2)));
            if (e < 4000) requestAnimationFrame(step);
            else resolve(Math.max(...times.slice(1).map((x, i) => x - times[i])));
          }
          requestAnimationFrame(step);
        }),
      hi,
    );
  await oscillate();
  const worst = await oscillate();
  if (worst <= 80) ok(`stall: worst frame ${worst.toFixed(0)} ms crossing the school's window edge`);
  else fail(`stall: a ${worst.toFixed(0)} ms frame crossing the school's window edge (limit 80 ms)`);
  if (errors.length) fail(`stall: page errors: ${errors.join(' | ')}`);
  await context.close();
}

async function exportStills(browser) {
  const dir = path.join(repoRoot, 'public', 'dive', 'stills');
  await fs.mkdir(dir, { recursive: true });
  const { context, page } = await openReview(browser, DESKTOP);
  const sections = await page.evaluate(() => window.__dive.sections);
  for (const [id, p] of Object.entries(sections)) {
    await fs.writeFile(path.join(dir, `${id}.jpg`), await frame(page, p, TIME_S, 1, 'jpeg'));
  }
  ok(`stills: ${Object.keys(sections).length} written to public/dive/stills/`);
  await context.close();
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Serving dist/ on ${PORT}; output in ${path.relative(repoRoot, outDir)}`);
  const { child } = await startServer(PORT);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    await contactSheets(browser);
    if (flag('strips')) await strips(browser);
    if (flag('stills')) await exportStills(browser);
    if (flag('flash')) await flashCheck(browser);
    await determinism(browser);
    await resizeCheck(browser);
    await contextLossCheck(browser);
    await earlyContextLossCheck(browser);
    await keyboardCheck(browser);
    await soundCheck(browser);
    await reducedMotionCheck(browser);
    await noWebglCheck();
    await stallCheck(browser);
    if (flag('loudness')) await loudness(browser);
  } finally {
    await browser.close();
    await stopServer(child);
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
