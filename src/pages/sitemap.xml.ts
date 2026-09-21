import type { APIRoute } from 'astro';

// Four known static pages. Hand-rolled rather than @astrojs/sitemap: that
// package is a dependency and a config change to produce twenty lines of
// XML for a URL set this small and this fixed.
// Trailing slashes are included to match the pages' canonical URLs.
const pages = ['/', '/work/', '/projects/', '/outside/'];

export const GET: APIRoute = ({ site }) => {
  const urls = pages
    .map((page) => `  <url>\n    <loc>${new URL(page, site).href}</loc>\n  </url>`)
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
