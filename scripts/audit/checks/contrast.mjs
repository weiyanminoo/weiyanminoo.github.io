// Check 2 — contrast, the acceptance criterion. For every text-bearing
// element on all four pages: grid-sample its box (never a single pixel),
// against the actual composited pixel (see lib/pixels.mjs for why that is a
// screenshot read, not canvas.getImageData), across >=5 time samples with
// the real animation loop running, and take the worst ratio.

import {
  PAGES,
  BASE_URL,
  DESKTOP_VIEWPORT,
  CONTRAST_NORMAL,
  CONTRAST_LARGE,
  LARGE_TEXT_PX,
  LARGE_BOLD_TEXT_PX,
} from '../lib/constants.mjs';
import { settle } from '../lib/wait.mjs';
import { installDepthListener, readDepth } from '../lib/depthEvent.mjs';
import { collectTextElements, hideElementGlyphs } from '../lib/textElements.mjs';
import { captureFrame, pixelAt, contrastRatio, parseCssColor } from '../lib/pixels.mjs';

const TIME_SAMPLES = 5;
const TIME_SAMPLE_SPACING_MS = 500; // 5 samples x 500ms = 2.5s+ per scroll stop, loop running throughout
const GRID_STEP = 14; // px between grid sample points within an element's (visible) box
const MAX_GRID_POINTS = 36;

function isLargeText(fontSizePx, fontWeight) {
  const weight = parseInt(fontWeight, 10) || 400;
  return fontSizePx >= LARGE_TEXT_PX || (fontSizePx >= LARGE_BOLD_TEXT_PX && weight >= 700);
}

// Grid points within the part of `el`'s box currently on screen at scroll
// offset `stop`, in viewport coordinates. Clipped to [0, viewportHeight) so
// an element straddling a scroll-stop boundary is never sampled past the
// edge of what that stop's screenshot actually shows.
function visibleGridPoints(el, stop, viewportHeight) {
  const top = Math.max(0, el.docTop - stop);
  const bottom = Math.min(viewportHeight, el.docTop - stop + el.height);
  const left = el.left;
  const right = el.left + el.width;
  if (bottom <= top || right <= left) return [];

  const xs = [];
  for (let x = left + GRID_STEP / 2; x < right; x += GRID_STEP) xs.push(x);
  if (xs.length === 0) xs.push((left + right) / 2);

  const ys = [];
  for (let y = top + GRID_STEP / 2; y < bottom; y += GRID_STEP) ys.push(y);
  if (ys.length === 0) ys.push((top + bottom) / 2);

  const points = [];
  for (const y of ys) {
    for (const x of xs) {
      points.push([x, y]);
      if (points.length >= MAX_GRID_POINTS) return points;
    }
  }
  return points;
}

// A sticky header sits above the canvas in real stacking order, so a
// heading that has scrolled to just below the viewport top can be partly or
// fully covered by it — completely ordinary sticky-header behaviour, not a
// contrast defect (the covered part isn't rendered at all, so there is
// nothing there to fail a ratio against). elementFromPoint is the general,
// structure-agnostic way to tell "really painted for this element, here" —
// the same reasoning as lib/pixels.mjs's screenshot-over-DOM-walk choice —
// rather than hardcoding the header's height and hoping nothing else is
// ever stacked on top of body text.
async function filterOccludedPoints(page, targets) {
  return page.evaluate((items) => {
    function isSelfOrDescendant(hit, target) {
      let cur = hit;
      while (cur) {
        if (cur === target) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    const result = {};
    for (const { id, points } of items) {
      const target = document.querySelector(`[data-audit-id="${CSS.escape(id)}"]`);
      result[id] = target
        ? points.filter(([x, y]) => isSelfOrDescendant(document.elementFromPoint(x, y), target))
        : [];
    }
    return result;
  }, targets);
}

async function injectLowContrastElement(page) {
  await page.evaluate(() => {
    const el = document.createElement('p');
    el.textContent = 'audit-injected-low-contrast-probe';
    el.setAttribute('data-audit-injected', 'true');
    el.style.position = 'absolute';
    el.style.top = '140px';
    el.style.left = '140px';
    el.style.margin = '0';
    // Deliberately near the foam/shallow water colour it sits over, well
    // under any real threshold — the harness's planted failure.
    el.style.color = 'rgb(150, 160, 158)';
    el.style.fontSize = '16px';
    el.style.fontWeight = '400';
    el.style.zIndex = '10';
    document.body.appendChild(el);
  });
}

async function measurePage(browser, path, injectFailure) {
  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installDepthListener(page);

  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 4);

    if (injectFailure) {
      await injectLowContrastElement(page);
    }

    const elements = await collectTextElements(page);
    // Hide every candidate's own glyphs so grid sampling can only ever read
    // real background pixels, never the element's own ink — see
    // hideElementGlyphs' doc comment. Foreground colour for the comparison
    // was already captured (per-element, via getComputedStyle) above.
    await hideElementGlyphs(page, elements.map((el) => el.id));

    const viewportHeight = DESKTOP_VIEWPORT.height;
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const maxScroll = Math.max(0, documentHeight - viewportHeight);

    // 50% overlap: guarantees any element shorter than one viewport is
    // fully on-screen (not boundary-clipped) at at least one stop.
    const step = Math.max(1, Math.round(viewportHeight / 2));
    const stops = [];
    for (let y = 0; y <= maxScroll; y += step) stops.push(y);
    if (stops[stops.length - 1] !== maxScroll) stops.push(maxScroll);

    let worst = null;
    let samplePoints = 0;

    for (const stop of stops) {
      const candidates = elements
        .map((el) => ({ el, points: visibleGridPoints(el, stop, viewportHeight) }))
        .filter((c) => c.points.length > 0);
      if (candidates.length === 0) continue;

      await page.evaluate((y) => window.scrollTo(0, y), stop);
      await settle(page, 4);

      // Drop points covered by something else in front of the element at
      // this scroll position (e.g. the sticky header) before spending any
      // screenshots on them.
      const clearedById = await filterOccludedPoints(
        page,
        candidates.map((c) => ({ id: c.el.id, points: c.points }))
      );
      const visible = candidates
        .map((c) => ({ el: c.el, points: clearedById[c.el.id] ?? [] }))
        .filter((c) => c.points.length > 0);
      if (visible.length === 0) continue;

      const frames = [];
      let depthAtStop = null;
      for (let i = 0; i < TIME_SAMPLES; i++) {
        if (i > 0) await page.waitForTimeout(TIME_SAMPLE_SPACING_MS);
        await settle(page, 1);
        frames.push(await captureFrame(page));
        depthAtStop = await readDepth(page);
      }

      for (const { el, points } of visible) {
        const fg = parseCssColor(el.color);
        const large = isLargeText(el.fontSizePx, el.fontWeight);
        const required = large ? CONTRAST_LARGE : CONTRAST_NORMAL;

        for (const frame of frames) {
          for (const [x, y] of points) {
            samplePoints += 1;
            const bg = pixelAt(frame, x, y);
            const ratio = contrastRatio(fg, bg);
            if (!worst || ratio < worst.ratio) {
              worst = {
                ratio,
                required,
                large,
                page: path,
                tag: el.tag,
                text: el.text,
                depth: depthAtStop ? depthAtStop.metres : null,
                fg,
                bg,
              };
            }
          }
        }
      }
    }

    return { worst, elementCount: elements.length, samplePoints };
  } finally {
    await context.close();
  }
}

export async function runContrastCheck(browser, { injectFailure = false } = {}) {
  const name = 'Contrast';
  const lines = [
    'aria-hidden subtrees excluded from the sweep (e.g. the depth rail, which sits on its own scrim, not the water).',
  ];
  if (injectFailure) {
    lines.push('DELIBERATE FAILURE INJECTION ACTIVE: a low-contrast probe element is added to every page.');
  }
  let allPassed = true;

  for (const path of PAGES) {
    const { worst, elementCount, samplePoints } = await measurePage(browser, path, injectFailure);
    if (!worst) {
      lines.push(`${path}: no text-bearing elements found (${elementCount} candidates) — FAIL`);
      allPassed = false;
      continue;
    }
    const passed = worst.ratio >= worst.required;
    if (!passed) allPassed = false;
    const depthLabel = worst.depth === null || worst.depth === undefined ? 'unknown' : `${worst.depth.toFixed(1)}m`;
    lines.push(
      `${path}: worst ${worst.ratio.toFixed(2)}:1 (need ${worst.required}:1${worst.large ? ', large text' : ''}) ` +
        `on <${worst.tag}> "${worst.text}" at ~${depthLabel} — fg rgb(${worst.fg.join(', ')}) vs rendered bg rgb(${worst.bg.join(', ')}) ` +
        `[${elementCount} elements, ${samplePoints} sample points checked] — ${passed ? 'OK' : 'FAIL'}`
    );
  }

  return { name, passed: allPassed, lines, fatal: false };
}
