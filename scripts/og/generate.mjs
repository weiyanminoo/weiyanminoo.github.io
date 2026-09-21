// One-off asset generator. Not wired into `npm run build` — run manually
// with `node scripts/og/generate.mjs` whenever the OG card's copy or
// styling needs to change. Renders a typographic HTML card to a 1200x630
// PNG using the site's real fonts and tokens, then writes public/og.png.
// The site builds with no browser present; this script is a tool, and its
// output is committed.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../..');
const fontFile = (pkg, file) =>
  pathToFileURL(path.join(rootDir, 'node_modules/@fontsource-variable', pkg, 'files', file)).href;

const archivo = fontFile('archivo', 'archivo-latin-wght-normal.woff2');
const splineMono = fontFile('spline-sans-mono', 'spline-sans-mono-latin-wght-normal.woff2');

// Tokens copied from src/styles/tokens.css — this script runs standalone,
// outside Astro, so it cannot import the CSS custom properties directly.
const tokens = {
  foam: '#F6F9F9',
  shallow: '#E9F1F2',
  mid: '#CFE1E4',
  deep: '#1B4A5C',
  ink: '#0B2A3A',
  ink2: '#31535E',
  ink3: '#27454F',
  onDeep3: '#AECDD4',
  mark: '#F2C230',
};

// Copy pulled verbatim from src/pages/index.astro: the page title's role
// line and the hero's meta line. Nothing invented here.
const name = 'Wei Yan';
const roleLine = 'Computer Science, NUS';
const metaLine = 'SINGAPORE · CLASS OF 2027 · NUS MERIT SCHOLAR';

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Archivo Variable';
    src: url('${archivo}') format('woff2-variations');
    font-weight: 100 900;
  }
  @font-face {
    font-family: 'Spline Sans Mono Variable';
    src: url('${splineMono}') format('woff2-variations');
    font-weight: 100 900;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 1200px;
    height: 630px;
  }

  body {
    position: relative;
    background: linear-gradient(
      180deg,
      ${tokens.foam} 0%,
      ${tokens.shallow} 40%,
      ${tokens.mid} 70%,
      ${tokens.deep} 100%
    );
    font-family: 'Archivo Variable', sans-serif;
    overflow: hidden;
  }

  .card {
    position: absolute;
    top: 96px;
    left: 96px;
    right: 96px;
  }

  h1 {
    margin: 0 0 20px;
    font-weight: 800;
    font-size: 128px;
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: ${tokens.ink};
  }

  .role {
    margin: 0 0 28px;
    font-weight: 700;
    font-size: 42px;
    color: ${tokens.ink2};
  }

  .meta {
    margin: 0;
    font-family: 'Spline Sans Mono Variable', monospace;
    font-size: 22px;
    letter-spacing: 0.14em;
    color: ${tokens.ink3};
  }

  /* the depth-rail motif, echoed from the favicon: a marker descending
     the water column, placed in the deep band at the foot of the card */
  .rail {
    position: absolute;
    left: 96px;
    bottom: 84px;
    width: 2px;
    height: 120px;
    background: ${tokens.onDeep3};
    opacity: 0.5;
  }

  .marker {
    position: absolute;
    left: 89px;
    bottom: 130px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${tokens.mark};
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <p class="role">${roleLine}</p>
    <p class="meta">${metaLine}</p>
  </div>
  <div class="rail"></div>
  <div class="marker"></div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const outPath = path.join(rootDir, 'public/og.png');
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote public/og.png (1200x630)`);
} finally {
  await browser.close();
}
