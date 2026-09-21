// One-off asset generator. Not wired into `npm run build` — run manually
// with `node scripts/og/generate-favicons.mjs` whenever public/favicon.svg
// changes. Renders the hand-authored favicon SVG to the raster fallbacks
// referenced from BaseLayout.astro's head: a 32x32 PNG for browsers that
// don't support SVG favicons, and a 180x180 apple-touch-icon.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../..');
const svgPath = path.join(rootDir, 'public/favicon.svg');
const svgMarkup = await readFile(svgPath, 'utf8');

const targets = [
  { size: 32, out: 'public/favicon-32.png' },
  { size: 180, out: 'public/apple-touch-icon.png' },
];

const browser = await chromium.launch();
try {
  for (const { size, out } of targets) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8" /><style>
        html, body { margin: 0; padding: 0; }
        svg { display: block; width: ${size}px; height: ${size}px; }
      </style></head><body>${svgMarkup}</body></html>`,
    );
    const outPath = path.join(rootDir, out);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`wrote ${out} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
