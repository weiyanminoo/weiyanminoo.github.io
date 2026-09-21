import { chromium } from 'playwright';
import { startServer, stopServer } from '../scripts/audit/lib/server.mjs';
import { settle } from '../scripts/audit/lib/wait.mjs';

const PORT = 4325;
const PAGES = ['/', '/work', '/projects', '/outside'];
const WIDTHS = [375, 1440];

async function main() {
  const server = await startServer(PORT);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of WIDTHS) {
      for (const p of PAGES) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${PORT}${p}`, { waitUntil: 'load' });
        await settle(page, 3);
        const result = await page.evaluate(({ w }) => {
          const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          if (!overflow) return { overflow: false };
          const offenders = [];
          for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const eps = 0.5;
            if (rect.right > w + eps || rect.left < -eps) {
              offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === 'string' ? el.className : '',
                right: Math.round(rect.right),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
              });
            }
          }
          return {
            overflow: true,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            offenders,
          };
        }, { w: width });
        console.log(`${width}px ${p}:`, JSON.stringify(result));
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server.child);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
