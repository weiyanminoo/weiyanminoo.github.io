#!/usr/bin/env node
// Throwaway: reuses the real audit's own instrument (scripts/audit/lib/*,
// imported not modified) to split the same contrast sweep contrast.mjs
// already runs into "on a card" vs "not on a card" categories, and report
// the worst ratio in each — for the phase-7 report's requirement to state
// these separately. Not part of the audit itself; scripts/audit/ is
// untouched.

import { chromium } from 'playwright';
import { PAGES, BASE_URL, PREVIEW_PORT, DESKTOP_VIEWPORT, CONTRAST_NORMAL, CONTRAST_LARGE, LARGE_TEXT_PX, LARGE_BOLD_TEXT_PX } from '../scripts/audit/lib/constants.mjs';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';
import { collectTextElements, hideElementGlyphs } from '../scripts/audit/lib/textElements.mjs';
import { captureFrame, pixelAt, contrastRatio, parseCssColor } from '../scripts/audit/lib/pixels.mjs';

const TIME_SAMPLES = 5;
const TIME_SAMPLE_SPACING_MS = 500;
const GRID_STEP = 14;
const MAX_GRID_POINTS = 36;

function isLargeText(fontSizePx, fontWeight) {
  const weight = parseInt(fontWeight, 10) || 400;
  return fontSizePx >= LARGE_TEXT_PX || (fontSizePx >= LARGE_BOLD_TEXT_PX && weight >= 700);
}

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
      result[id] = target ? points.filter(([x, y]) => isSelfOrDescendant(document.elementFromPoint(x, y), target)) : [];
    }
    return result;
  }, targets);
}

// Card ancestry check: does this element sit inside something carrying the
// .glass-card class or one of the inline card classes (.role, .project,
// .topic, .interest, .card, li inside .role-list/.project-list)? Mirrors
// exactly what got a card in this round's CSS (base.css/.glass-card,
// RoleEntry/ProjectCard/outside.astro/index.astro/SiteFooter/SiteHeader).
async function tagCardAncestry(page, ids) {
  return page.evaluate((elementIds) => {
    const result = {};
    for (const id of elementIds) {
      const el = document.querySelector(`[data-audit-id="${CSS.escape(id)}"]`);
      let cur = el;
      let onCard = false;
      while (cur && cur !== document.body) {
        if (cur.classList && (cur.classList.contains('glass-card') || cur.classList.contains('site-header'))) {
          onCard = true;
          break;
        }
        cur = cur.parentElement;
      }
      result[id] = onCard;
    }
    return result;
  }, ids);
}

async function measurePage(browser, path) {
  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 4);

  const elements = await collectTextElements(page);
  await hideElementGlyphs(page, elements.map((el) => el.id));
  const ancestry = await tagCardAncestry(page, elements.map((el) => el.id));

  const viewportHeight = DESKTOP_VIEWPORT.height;
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const maxScroll = Math.max(0, documentHeight - viewportHeight);
  const step = Math.max(1, Math.round(viewportHeight / 2));
  const stops = [];
  for (let y = 0; y <= maxScroll; y += step) stops.push(y);
  if (stops[stops.length - 1] !== maxScroll) stops.push(maxScroll);

  const worstByCategory = { card: null, notCard: null };

  for (const stop of stops) {
    const candidates = elements
      .map((el) => ({ el, points: visibleGridPoints(el, stop, viewportHeight) }))
      .filter((c) => c.points.length > 0);
    if (candidates.length === 0) continue;

    await page.evaluate((y) => window.scrollTo(0, y), stop);
    await settle(page, 4);

    const clearedById = await filterOccludedPoints(page, candidates.map((c) => ({ id: c.el.id, points: c.points })));
    const visible = candidates
      .map((c) => ({ el: c.el, points: clearedById[c.el.id] ?? [] }))
      .filter((c) => c.points.length > 0);
    if (visible.length === 0) continue;

    const frames = [];
    for (let i = 0; i < TIME_SAMPLES; i++) {
      if (i > 0) await page.waitForTimeout(TIME_SAMPLE_SPACING_MS);
      await settle(page, 1);
      frames.push(await captureFrame(page));
    }

    for (const { el, points } of visible) {
      const fg = parseCssColor(el.color);
      const large = isLargeText(el.fontSizePx, el.fontWeight);
      const required = large ? CONTRAST_LARGE : CONTRAST_NORMAL;
      const category = ancestry[el.id] ? 'card' : 'notCard';

      for (const frame of frames) {
        for (const [x, y] of points) {
          const bg = pixelAt(frame, x, y);
          const ratio = contrastRatio(fg, bg);
          const cur = worstByCategory[category];
          if (!cur || ratio < cur.ratio) {
            worstByCategory[category] = { ratio, required, large, page: path, tag: el.tag, text: el.text, fg, bg };
          }
        }
      }
    }
  }

  await context.close();
  return worstByCategory;
}

async function main() {
  console.log(`Starting astro preview on port ${PREVIEW_PORT}...`);
  const server = await startServer(PREVIEW_PORT);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const globalWorst = { card: null, notCard: null };
    for (const path of PAGES) {
      const worst = await measurePage(browser, path);
      console.log(`\n${path}:`);
      for (const cat of ['card', 'notCard']) {
        const w = worst[cat];
        if (!w) {
          console.log(`  ${cat}: (no elements in this category on this page)`);
          continue;
        }
        console.log(
          `  ${cat}: ${w.ratio.toFixed(2)}:1 (need ${w.required}:1${w.large ? ', large' : ''}) on <${w.tag}> "${w.text}" — fg rgb(${w.fg.join(',')}) vs bg rgb(${w.bg.join(',')})`
        );
        if (!globalWorst[cat] || w.ratio < globalWorst[cat].ratio) {
          globalWorst[cat] = { ...w, page: path };
        }
      }
    }
    console.log('\n=== GLOBAL WORST ACROSS ALL 4 PAGES ===');
    for (const cat of ['card', 'notCard']) {
      const w = globalWorst[cat];
      console.log(`${cat}: ${w.ratio.toFixed(2)}:1 on ${w.page} <${w.tag}> "${w.text}"`);
    }
  } finally {
    await browser.close();
    await stopServer(server.child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
