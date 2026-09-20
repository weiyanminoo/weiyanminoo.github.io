// Pure maths for the water column's depth model. No DOM, no canvas — a later
// task wires this to a canvas and a depth rail.

export interface Band {
  readonly top: number;
  readonly bottom: number;
}

export const MAX_DEPTH = 32;
export const THERMOCLINE = 21;

/** Clamp `value` to the inclusive range [min, max]. Shared with palette.ts. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface RoutedBand extends Band {
  readonly segment: string;
}

// Ordered top to bottom, surface to floor. The three light pages (Home, Work,
// Projects) deliberately overlap each other so moving between them stays
// continuous. None of them may cross THERMOCLINE (21m): each page's text
// colour is fixed by its depth class, so a band straddling the thermocline
// would put light text on light water or dark text on dark water. Projects
// ends at 19m and Outside starts at 24m — inside the measured contrast
// limits (20m and 23m, where the dark-ink and on-deep tokens respectively
// stop clearing 4.5:1) with deliberate margin, since Phase 5's caustics,
// marine snow and dither overlay perturb the background locally and would
// eat a bare-floor margin immediately — leaving 19-24m as an unclaimed
// thermocline passage crossed only by navigating into Outside, never by
// scrolling within a page.
const BANDS: readonly RoutedBand[] = [
  { segment: '', top: 0, bottom: 7 }, // Home
  { segment: 'work', top: 5, bottom: 14 },
  { segment: 'projects', top: 12, bottom: 19 },
  { segment: 'outside', top: 24, bottom: 32 },
];

const HOME_BAND: Band = BANDS[0];

export function bandForPath(pathname: string): Band {
  const path = pathname.split(/[?#]/)[0]; // ignore query string / hash, if any
  const segment = path.split('/').filter(Boolean)[0] ?? '';
  const match = BANDS.find((band) => band.segment === segment);
  const { top, bottom } = match ?? HOME_BAND;
  return { top, bottom };
}

export function depthAt(band: Band, scrollProgress: number): number {
  const progress = clamp(scrollProgress, 0, 1);
  return band.top + (band.bottom - band.top) * progress;
}

export function normalisedDepth(metres: number): number {
  return clamp(metres, 0, MAX_DEPTH) / MAX_DEPTH;
}

export function isBelowThermocline(metres: number): boolean {
  return metres > THERMOCLINE;
}
