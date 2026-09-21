// Check 3 — horizontal overflow. Zero horizontal overflow at 375px and
// 1440px, on all four pages, with the offending element named.

import { PAGES, BASE_URL } from '../lib/constants.mjs';
import { settle } from '../lib/wait.mjs';

const WIDTHS = [375, 1440];
const EPSILON = 0.5; // sub-pixel layout rounding

async function findOffenders(page, viewportWidth) {
  return page.evaluate(
    (width, eps) => {
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.right > width + eps || rect.left < -eps) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className : '',
            right: Math.round(rect.right),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
          });
        }
      }
      return offenders;
    },
    viewportWidth,
    EPSILON
  );
}

export async function runOverflowCheck(browser) {
  const name = 'Horizontal overflow';
  const lines = [];
  let allPassed = true;

  for (const width of WIDTHS) {
    for (const path of PAGES) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
        await settle(page, 3);

        const hasOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        );

        if (!hasOverflow) {
          lines.push(`${width}px ${path}: no overflow — OK`);
          continue;
        }

        allPassed = false;
        const offenders = await findOffenders(page, width);
        if (offenders.length === 0) {
          lines.push(
            `${width}px ${path}: scrollWidth (${await page.evaluate(() => document.documentElement.scrollWidth)}px) > clientWidth (${width}px), but no single element's box exceeds the viewport — FAIL`
          );
        } else {
          const worst = offenders.reduce((a, b) => (b.right - width > a.right - width ? b : a));
          lines.push(
            `${width}px ${path}: overflow — worst offender <${worst.tag}${worst.cls ? `.${worst.cls.split(' ')[0]}` : ''}> ` +
              `right edge ${worst.right}px (viewport ${width}px, overflow ${worst.right - width}px); ${offenders.length} element(s) exceed the viewport — FAIL`
          );
        }
      } finally {
        await context.close();
      }
    }
  }

  return { name, passed: allPassed, lines, fatal: false };
}
