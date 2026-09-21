// Pure maths for the water column's depth model. No DOM, no canvas — a later
// task wires this to a canvas and a depth rail.

export interface Band {
  readonly top: number;
  readonly bottom: number;
}

// 'single' bands are a fixed-colour page: their text colour comes from one
// depth class on <html>, so the band may never cross THERMOCLINE (see
// below). 'column' is the one page that spans the whole water column and
// has no single text colour — it declares its own light/deep zones instead
// (see BaseLayout.astro) — so it is the only band allowed to cross it.
export type Zones = 'single' | 'column';

export interface ZonedBand extends Band {
  readonly zones: Zones;
}

export const MAX_DEPTH = 32;
export const THERMOCLINE = 21;

/** Clamp `value` to the inclusive range [min, max]. Shared with palette.ts. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface RoutedBand extends ZonedBand {
  readonly segment: string;
}

// Ordered top to bottom, surface to floor. Work and Projects deliberately
// overlap each other so moving between them stays continuous. Neither may
// cross THERMOCLINE (21m): each page's text colour is fixed by its depth
// class, so a band straddling the thermocline would put light text on light
// water or dark text on dark water. Projects ends at 19m and Outside starts
// at 24m — inside the measured contrast limits (20m and 23m, where the
// dark-ink and on-deep tokens respectively stop clearing 4.5:1) with
// deliberate margin, since Phase 5's caustics, marine snow and dither
// overlay perturb the background locally and would eat a bare-floor margin
// immediately — leaving 19-24m as an unclaimed thermocline passage crossed
// only by navigating into Outside, never by scrolling within a page.
//
// Home is the one exception: as of Phase 4c it is `zones: 'column'` and
// spans the entire 0-32m column, so the whole descent is felt on one page.
// It is the only band permitted to cross THERMOCLINE.
const BANDS: readonly RoutedBand[] = [
  { segment: '', top: 0, bottom: 32, zones: 'column' }, // Home
  { segment: 'work', top: 5, bottom: 14, zones: 'single' },
  { segment: 'projects', top: 12, bottom: 19, zones: 'single' },
  { segment: 'outside', top: 24, bottom: 32, zones: 'single' },
];

const HOME_BAND: ZonedBand = BANDS[0];

export function bandForPath(pathname: string): ZonedBand {
  const path = pathname.split(/[?#]/)[0]; // ignore query string / hash, if any
  const segment = path.split('/').filter(Boolean)[0] ?? '';
  const match = BANDS.find((band) => band.segment === segment);
  const { top, bottom, zones } = match ?? HOME_BAND;
  return { top, bottom, zones };
}

export function depthAt(band: Band, scrollProgress: number): number {
  const progress = clamp(scrollProgress, 0, 1);
  return band.top + (band.bottom - band.top) * progress;
}

/**
 * Maps a document-space Y position to metres for the `column` band (Home),
 * which spans the whole water column and is pinned to the thermocline
 * divider's real position rather than a hardcoded fraction of page height:
 *
 * - from the document top to the divider's centre (`thermoclineY`), depth
 *   runs 0m to THERMOCLINE, piecewise-linear.
 * - from the divider's centre to the document bottom, depth runs
 *   THERMOCLINE to MAX_DEPTH, piecewise-linear.
 *
 * `scrollY` and `viewportOffset` are added together to give the
 * document-space Y being queried (0 for the viewport top, viewportHeight
 * for the viewport bottom).
 *
 * Falls back to a straight 0-to-MAX_DEPTH linear mapping across the whole
 * document when `thermoclineY` is degenerate (absent, at/behind the top, or
 * at/beyond the document height) rather than dividing by a zero or negative
 * span.
 *
 * This is what the canvas gradient uses (true document position — physically
 * correct for what is painted on screen). The rail's numeric readout uses
 * `depthForColumnProgress` instead, which answers a different question ("how
 * far have I descended") and deliberately does not agree with this function
 * everywhere — see that function's comment. Do not merge the two.
 */
export function depthForColumn(
  scrollY: number,
  viewportOffset: number,
  documentHeight: number,
  thermoclineY: number
): number {
  const y = scrollY + viewportOffset;

  if (thermoclineY <= 0 || thermoclineY >= documentHeight) {
    return documentHeight > 0 ? clamp((y / documentHeight) * MAX_DEPTH, 0, MAX_DEPTH) : 0;
  }

  if (y <= thermoclineY) {
    return clamp((y / thermoclineY) * THERMOCLINE, 0, THERMOCLINE);
  }

  const belowSpan = documentHeight - thermoclineY;
  return clamp(
    THERMOCLINE + ((y - thermoclineY) / belowSpan) * (MAX_DEPTH - THERMOCLINE),
    THERMOCLINE,
    MAX_DEPTH
  );
}

/**
 * Maps scroll PROGRESS (0 = top of the scrollable range, 1 = bottom) to
 * metres for the `column` band's rail readout — deliberately not the same
 * mapping as `depthForColumn`, which maps a document-space Y position and
 * is what the canvas gradient uses. depthForColumn's viewport-top depth can
 * never reach MAX_DEPTH, because the viewport has real height and its top
 * edge can scroll at most to `documentHeight - viewportHeight` — one
 * viewport short of the document end. A "how far have I descended"
 * readout should still hit both ends of the band, so this pins THERMOCLINE
 * to the divider's own scroll-progress position (`thermoclineProgress`,
 * i.e. the progress value at which the viewport top would sit exactly on
 * the divider) rather than its document position, then runs
 * piecewise-linear same as depthForColumn: 0 to THERMOCLINE across
 * [0, thermoclineProgress], THERMOCLINE to MAX_DEPTH across
 * [thermoclineProgress, 1]. Guards the same way for a degenerate
 * `thermoclineProgress` (at/behind 0, or at/beyond 1).
 */
export function depthForColumnProgress(progress: number, thermoclineProgress: number): number {
  const p = clamp(progress, 0, 1);

  if (thermoclineProgress <= 0 || thermoclineProgress >= 1) {
    return clamp(p * MAX_DEPTH, 0, MAX_DEPTH);
  }

  if (p <= thermoclineProgress) {
    return clamp((p / thermoclineProgress) * THERMOCLINE, 0, THERMOCLINE);
  }

  const belowSpan = 1 - thermoclineProgress;
  return clamp(
    THERMOCLINE + ((p - thermoclineProgress) / belowSpan) * (MAX_DEPTH - THERMOCLINE),
    THERMOCLINE,
    MAX_DEPTH
  );
}

export function normalisedDepth(metres: number): number {
  return clamp(metres, 0, MAX_DEPTH) / MAX_DEPTH;
}

export function isBelowThermocline(metres: number): boolean {
  return metres > THERMOCLINE;
}
