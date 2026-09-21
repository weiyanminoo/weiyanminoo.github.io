// One tuning dial per effect, in one place — plan Phase 5 task 8. The
// contrast sweep (tests/water/effects.test.ts) is the only thing allowed to
// turn these values, and only downward, never up.

export const INTENSITY = {
  dither: 0.05, // overlay alpha of the noise tile
  caustics: 1, // multiplier on the trough depth
  shafts: 0.5, // peak alpha at the surface
  snow: 0.13, // peak alpha of one snow particle, at its full-strength depth
  // shoal and bubbles lowered from the brief's original 0.11/0.08 — the
  // coordinator re-ran the stacked contrast bound and found these give real
  // margin (4.816 at 13.25m) instead of a hair's breadth. See
  // tests/water/effects.test.ts.
  shoal: 0.1, // peak alpha of one fish
  bubbles: 0.07, // peak alpha of one bubble stroke
} as const;
