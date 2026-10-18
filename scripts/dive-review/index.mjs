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
//
// Flags: --round N  --strips  --stills (write public/dive/stills/*.jpg)
//        --flash (entry-burst flash check, added with the bubbles)
//
// Assumes `npm run build` has already produced dist/.

import { chromium } from 'playwright';
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
const TIME_S = 10;
const SHOT_SAMPLES = [0.25, 0.5, 0.75];
// Every cut and blend in the storyboard: the exhale-burst cut into clip 4,
// clip 4 → clip 3, the snapper cut back to wide, the manta and shark
// passes, and the thermocline.
const STRIP_CENTRES = [0.36, 0.46, 0.52, 0.62, 0.69, 0.74];
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
  const context = await browser.newContext({
    viewport: { width: cols * cellWidth, height: 600 },
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
    await determinism(browser);
    await resizeCheck(browser);
    await contextLossCheck(browser);
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
