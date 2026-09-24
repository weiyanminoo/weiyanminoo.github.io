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

/**
 * The depth every page other than Home paints, as a flat band (top ===
 * bottom, so `depthAt` returns it at every scroll position and the water
 * never moves). 6m is a stop in palette.ts's own table — rgb(234,242,243),
 * within one channel step of the --shallow token — so the canvas and the
 * no-JavaScript `html.depth-shallow` fallback background agree without a
 * second hand-kept colour.
 */
export const STILL = 6;

// Two cases, and only two. Home is the descent: `zones: 'column'`, spanning
// the whole 0-32m column, and the only band permitted to cross THERMOCLINE
// (it has no single fixed text colour — its sections declare their own light
// or deep zone; see BaseLayout.astro).
//
// Every other page is still water at a fixed STILL metres. Sub-pages used to
// carry a band each, descending 5-14m / 12-19m / 24-32m to match their
// position on Home; that coupling is gone by request — the tabs are plain
// reference pages now, with no rail, no depth markers and no descent. A flat
// band cannot cross THERMOCLINE, so the invariant that keeps a fixed-colour
// page off the mid-tone water holds trivially rather than by arithmetic.
const HOME_BAND: ZonedBand = { top: 0, bottom: MAX_DEPTH, zones: 'column' };
const STILL_BAND: ZonedBand = { top: STILL, bottom: STILL, zones: 'single' };

export function bandForPath(pathname: string): ZonedBand {
  const path = pathname.split(/[?#]/)[0]; // ignore query string / hash, if any
  const segment = path.split('/').filter(Boolean)[0] ?? '';
  return segment === '' ? HOME_BAND : STILL_BAND;
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
