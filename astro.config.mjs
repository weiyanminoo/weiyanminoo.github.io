// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages *user* site: served from the domain root.
  // Do NOT set `base` — a user site has no path prefix, and setting one
  // breaks every asset URL.
  site: 'https://weiyanminoo.github.io',
});
