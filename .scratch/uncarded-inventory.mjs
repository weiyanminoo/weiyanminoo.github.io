#!/usr/bin/env node
// Throwaway inventory: which text-bearing elements are NOT on a card, and
// what WCAG threshold each one actually needs (large vs normal). No pixel
// sampling — just the DOM facts, so it runs in seconds. Reuses the audit's
// own collectTextElements so the element set is identical to the arbiter's.

import { chromium } from 'playwright';
import { PAGES, BASE_URL, PREVIEW_PORT, DESKTOP_VIEWPORT, LARGE_TEXT_PX, LARGE_BOLD_TEXT_PX } from '../scripts/audit/lib/constants.mjs';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';
import { collectTextElements } from '../scripts/audit/lib/textElements.mjs';

function isLargeText(fontSizePx, fontWeight) {
  const weight = parseInt(fontWeight, 10) || 400;
  return fontSizePx >= LARGE_TEXT_PX || (fontSizePx >= LARGE_BOLD_TEXT_PX && weight >= 700);
}

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

async function main() {
  const viewports = [
    ['desktop', DESKTOP_VIEWPORT],
    ['mobile', { width: 375, height: 812 }],
  ];
  const server = await startServer(PREVIEW_PORT);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [vpName, viewport] of viewports) {
      console.log(`\n######## ${vpName} ${viewport.width}x${viewport.height} ########`);
      for (const path of PAGES) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await settle(page, 3);
        const elements = await collectTextElements(page);
        const ancestry = await tagCardAncestry(page, elements.map((e) => e.id));
        console.log(`\n=== ${path} (${elements.length} text elements) ===`);
        for (const el of elements) {
          if (ancestry[el.id]) continue;
          const large = isLargeText(el.fontSizePx, el.fontWeight);
          console.log(
            `  UNCARDED <${el.tag}> ${el.fontSizePx}px/${el.fontWeight} ${large ? 'LARGE(3:1)' : '**NORMAL(4.5:1)**'} ${el.color} docTop=${Math.round(el.docTop)} :: "${el.text}"`
          );
        }
      }
    }
  } finally {
    await browser.close();
    await stopServer(server.child);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
