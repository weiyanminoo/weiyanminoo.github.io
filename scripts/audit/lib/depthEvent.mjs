// Reads depth (in metres) from the site's own `water:depth` CustomEvent —
// the same event canvas.ts dispatches for the depth rail to consume. This
// is not a production test hook: it is the app's existing public contract
// on `window`, already relied on by DepthRail.astro. The harness listens to
// it purely to label *where* a measurement happened for the report (e.g.
// "worst ratio at 13m"); it plays no part in any pass/fail decision, which
// is always a real measured pixel.

/** Call once per page, before navigation, so no early events are missed. */
export async function installDepthListener(page) {
  await page.addInitScript(() => {
    window.__auditDepth = null;
    window.addEventListener('water:depth', (event) => {
      window.__auditDepth = event.detail;
    });
  });
}

export async function readDepth(page) {
  return page.evaluate(() => window.__auditDepth);
}
