// Check 4 — renders without JavaScript. With scripting disabled, every page
// must still serve its content: h1, body copy, and navigation present and
// non-empty. The canvas is an enhancement; a script failure must never
// leave a page blank. Asserts on real text content, not just presence.

import { PAGES, BASE_URL, DESKTOP_VIEWPORT } from '../lib/constants.mjs';

export async function runNoJsCheck(browser) {
  const name = 'Renders without JavaScript';
  const lines = [];
  let allPassed = true;

  for (const path of PAGES) {
    const context = await browser.newContext({
      viewport: DESKTOP_VIEWPORT,
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });

      const h1Text = (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? '';
      const navLinks = await page.locator('nav a').allTextContents();
      const nonEmptyNavLinks = navLinks.map((t) => t.trim()).filter(Boolean);
      const bodyText = (await page.locator('main').first().textContent().catch(() => null))?.trim() ?? '';

      const h1Ok = h1Text.length > 0;
      const navOk = nonEmptyNavLinks.length >= 4; // Home, Work, Projects, Outside
      // Body copy beyond just the h1 itself.
      const bodyOk = bodyText.length > h1Text.length + 10;

      const passed = h1Ok && navOk && bodyOk;
      if (!passed) allPassed = false;

      lines.push(
        `${path}: h1="${h1Text}" (${h1Ok ? 'OK' : 'FAIL'}), nav links=${nonEmptyNavLinks.length} (${navOk ? 'OK' : 'FAIL'}), ` +
          `main text length=${bodyText.length}chars (${bodyOk ? 'OK' : 'FAIL'}) — ${passed ? 'OK' : 'FAIL'}`
      );
    } finally {
      await context.close();
    }
  }

  return { name, passed: allPassed, lines, fatal: false };
}
