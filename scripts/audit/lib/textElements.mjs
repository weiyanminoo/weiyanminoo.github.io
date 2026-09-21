// Enumerates "text-bearing elements" on a freshly-loaded page: elements
// with their own direct (non-whitespace) text, visible, and not inside an
// aria-hidden subtree. Excluding aria-hidden here is what keeps the depth
// rail (aria-hidden="true", DepthRail.astro) out of the sweep — it sits on
// its own scrim, not the water, so testing it against the canvas is one of
// the false failures this harness exists to avoid.
//
// Must be called immediately after navigation, before any scroll, so
// getBoundingClientRect()'s viewport-relative top is also its document-
// relative top (scrollY === 0). Each matched element gets a
// `data-audit-id` attribute so later steps can re-locate it without holding
// a live handle across navigations.

export async function collectTextElements(page) {
  return page.evaluate(() => {
    function hasDirectText(el) {
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
          return true;
        }
      }
      return false;
    }

    function isAriaHidden(el) {
      let cur = el;
      while (cur) {
        if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    }

    function isVisible(el, style) {
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      if (parseFloat(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    const results = [];
    let counter = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!hasDirectText(el)) continue;
      const style = getComputedStyle(el);
      if (!isVisible(el, style)) continue;
      if (isAriaHidden(el)) continue;

      const rect = el.getBoundingClientRect();
      const id = `audit-el-${counter++}`;
      el.setAttribute('data-audit-id', id);

      results.push({
        id,
        tag: el.tagName.toLowerCase(),
        text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
        color: style.color,
        fontSizePx: parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        // Document-relative — valid because scrollY is 0 when this runs.
        docTop: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    }
    return results;
  });
}

/**
 * Makes every collected element's own glyphs invisible (color: transparent,
 * !important — a paint-only property, so it cannot move or resize anything
 * collectTextElements already measured) without touching layout, box
 * backgrounds/borders, or anything else. Grid-sampling an element's box for
 * "the background behind it" must never land on the element's own ink — a
 * pixel in the middle of a glyph stroke reads as (approximately) the
 * foreground colour itself, which would report a false ~1:1 "worst ratio"
 * on every page, on whichever heading happens to have the densest ink. The
 * element's real foreground colour for the contrast comparison always comes
 * from computed style (captured before this runs), never from sampling the
 * rendered glyph.
 */
export async function hideElementGlyphs(page, ids) {
  await page.evaluate((elementIds) => {
    for (const id of elementIds) {
      const el = document.querySelector(`[data-audit-id="${CSS.escape(id)}"]`);
      if (el) {
        el.style.setProperty('color', 'transparent', 'important');
      }
    }
  }, ids);
}
