// Pixel measurement primitives, all built on one mechanism: a real
// Playwright screenshot, decoded to raw RGBA. Deliberately not
// canvas.getImageData for the DOM-vs-canvas ground question — the header
// (`SiteHeader.astro`, `background: var(--bg)`) and the "Current" role badge
// (`RoleEntry.astro`, `background: var(--mark)`) both paint an opaque DOM
// layer *over* the water canvas, so the canvas pixel behind their text is
// not what a viewer actually sees there. A screenshot captures the final
// compositing — canvas, effects, and any opaque DOM on top of it — exactly
// as rendered, with no per-component reasoning about what is "the ground"
// required. That reasoning-by-DOM-structure is exactly what produced one of
// the false failures this harness exists to prevent (a scrim read as the
// wrong ground because it was a sibling, not an ancestor); reading the
// composited pixel sidesteps the question instead of re-litigating it.

import { PNG } from 'pngjs';

/** Takes a viewport screenshot and decodes it to a plain RGBA frame. */
export async function captureFrame(page) {
  const buffer = await page.screenshot({ type: 'png' });
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

/** Nearest-pixel RGB read from a captured frame, clamped to its bounds. */
export function pixelAt(frame, x, y) {
  const xi = Math.min(frame.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(frame.height - 1, Math.max(0, Math.round(y)));
  const idx = (yi * frame.width + xi) * 4;
  return [frame.data[idx], frame.data[idx + 1], frame.data[idx + 2]];
}

function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

export function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two sRGB colours, >= 1. */
export function contrastRatio(rgbA, rgbB) {
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function colourDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Parses a CSS `rgb(...)`/`rgba(...)` computed-style string into [r,g,b]. */
export function parseCssColor(css) {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    throw new Error(`Could not parse computed colour: ${css}`);
  }
  const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2]];
}
