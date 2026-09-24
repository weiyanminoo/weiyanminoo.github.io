// Shared constants for the audit harness. One place for the things every
// check needs to agree on.

// The site's five pages. Order matters only for report readability.
export const PAGES = ['/', '/work', '/school', '/projects', '/hobbies'];

// Port for the audit's own `astro preview` instance. Deliberately not 4321
// (the port `.claude/launch.json`'s interactive preview uses) so this
// harness never fights a preview server the user left running.
export const PREVIEW_PORT = 4322;
export const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

// deviceScaleFactor: 1 everywhere so a screenshot's pixel grid is exactly
// the CSS viewport's pixel grid, with no device-pixel-ratio scaling to
// account for — one less variable between a local run and CI.
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// WCAG 2.x thresholds.
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3.0;
// "Large text" per WCAG: >=24px (18pt), or >=18.66px (14pt) AND bold (>=700).
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = 18.66;

// The palette's deepest stop (32m), quoted directly from
// src/scripts/water/palette.ts — read for reference, not imported, and
// never modified. Used only by the self-check's freshness assertion.
export const DEEPEST_STOP_RGB = [11, 42, 58];
