// Marine life through the column, each species placed at the depth it is
// actually encountered at, and drawn from real silhouette artwork rather
// than procedural curves.
//
// WHY THE ARTWORK MATTERS. PRODUCT.md records a standing rule: a marine
// silhouette "must not be freehand-authored as bezier curves — an
// approximated organic contour reads worse than omitting the effect". An
// earlier revision of this file ignored that and authored the shapes by
// hand; the dolphin rendered as an arrowhead and the turtle as a ragged
// insect, exactly as the rule predicts. The shapes now come from real SVGs
// (src/assets/fauna/, normalised in faunaArt.ts), which is what lifts the
// old 45px size cap and lets the manta be the large slow presence the
// product brief always wanted.
//
// DEPTHS ARE RESEARCHED, not chosen for looks — see each band below.
//
// Closed-form in `time`, like every other effect here: no integrated state,
// so the reduced-motion frame at time = 0 is a real composed frame.

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';
import { FAUNA_ART, type FaunaSpecies } from './faunaArt';

// Light-water silhouette: the same blue-grey the shoal uses. Against
// near-white water a creature reads as a dark shape, which is what it is.
//
// Every species is now a single closed contour, so a plain fill is a solid
// silhouette and there is no dilation step. There used to be one: the old
// turtle artwork was a set of separate shell plates with real gaps between
// them, which no fill rule closes, so that path was additionally STROKED with
// a round join to swell the geometry until the gaps shut. Replacing that
// artwork with a single-contour turtle removed the only thing that needed it
// (the rays' and tuna's holes were interior subpaths, deleted from the path
// data in faunaArt.ts instead, which costs nothing). Dropping the stroke also
// returns the ~15fps it cost while scrolling, and stops it darkening the
// water — it once pushed a tag on Home below contrast.
const LIGHT_SILHOUETTE: readonly [number, number, number] = [40, 72, 88];

// Dark-water silhouette: palette.ts's own deepest stop (32m). Below the
// thermocline a creature is DARKER than the water behind it — there is no
// light down there to catch. That also makes this layer free: darkening
// already-dark water RAISES contrast for the on-deep tokens, so unlike
// every other deep effect it spends no headroom.
const DEEP_SILHOUETTE: readonly [number, number, number] = [11, 42, 58];

interface Band {
  readonly inFrom: number;
  readonly inTo: number;
  readonly outFrom: number;
  readonly outTo: number;
  readonly deep: boolean;
}

// Researched depth bands. Sources are in the phase notes; the short version:
//
// - Green turtle: forages in shallow seagrass and reef, long foraging dives
//   typically 10-20m, and surfaces to breathe every few minutes. Shallowest
//   resident here.
// - Yellowfin tuna: spends the majority of its time ABOVE the thermocline,
//   in the warm mixed layer. This column has a real thermocline at 21m, so
//   the tuna stop at it. That boundary is doing genuine work, not decoration.
// - Reef manta: cleaning stations sit at roughly 10-30m, commonly around
//   10m. Kept above the thermocline so its silhouette treatment never has to
//   hand over mid-animal.
// - Reef shark: grey/whitetip reef sharks work the deeper reef and drop-offs
//   well below the thermocline. (Blacktips genuinely are a shallow, reef-flat
//   species — this artwork is placed as the deeper reef sharks.)
// - Blue-spotted stingray: benthic, reported to around 25m in Australian
//   waters. Lowest resident, near the floor of the column.
const BANDS: Record<FaunaSpecies, Band> = {
  turtle: { inFrom: 0.5, inTo: 2, outFrom: 14, outTo: 11, deep: false },
  tuna: { inFrom: 5, inTo: 7, outFrom: 20, outTo: 17, deep: false },
  manta: { inFrom: 12, inTo: 14, outFrom: 20, outTo: 18, deep: false },
  shark: { inFrom: 22, inTo: 24, outFrom: 30, outTo: 28, deep: true },
  stingray: { inFrom: 23, inTo: 25, outFrom: 32, outTo: 30, deep: true },
};

// On-screen length along travel, in CSS pixels, scaled to the animals'
// real relative sizes: a reef manta spans 3-5.5m, a reef shark runs 1.5-2m,
// a green turtle's carapace is about 1m, a yellowfin is 1-1.5m, and a
// blue-spotted stingray's disc is well under a metre. Nothing here is the
// same size as anything else, which is the point.
const LENGTH: Record<FaunaSpecies, number> = {
  manta: 132,
  shark: 66,
  turtle: 46,
  tuna: 40,
  stingray: 30,
};

/**
 * How a creature moves. Neither mode is a straight line.
 *
 * `traverse` crosses the viewport and wraps, but wanders vertically as it
 * goes, so its track is a slow sine rather than a rule.
 *
 * `patrol` is a Lissajous figure — x and y oscillate at DIFFERENT
 * frequencies, which traces arcs, loops and figure-eights that never quite
 * repeat within a viewing session. It stays in frame, which suits the
 * animals you would actually linger with (a manta at a cleaning station, a
 * shark working a wall) rather than ones passing through.
 *
 * Both are closed-form, so heading comes from the analytic derivative and
 * the creature always faces where it is genuinely going.
 */
type Motion = 'traverse' | 'patrol';

interface Creature {
  readonly species: FaunaSpecies;
  readonly motion: Motion;
  /** traverse: viewport widths per second. patrol: radians per second on x. */
  readonly speed: number;
  /** patrol: radians per second on y. Differs from `speed` — that is what
   *  bends the path into an arc instead of a diagonal line. */
  readonly speedY: number;
  /** Centre of the patrol, or the lane for a traverse. Viewport fractions. */
  readonly cx: number;
  readonly cy: number;
  /** Patrol amplitudes / traverse wander, as viewport fractions. */
  readonly ax: number;
  readonly ay: number;
  readonly phase: number;
  /** Multiplier on this individual's LENGTH, so same-species animals differ. */
  readonly scale: number;
}

// Deliberately few. PRODUCT.md asks for "a presence rather than
// decoration", and something at every depth all the time reads as an
// aquarium rather than a dive.
const CREATURES: readonly Creature[] = [
  // Surface: two turtles of noticeably different size, both wandering.
  { species: 'turtle', motion: 'patrol', speed: 0.055, speedY: 0.083, cx: 0.5, cy: 0.35, ax: 0.42, ay: 0.16, phase: 0.0, scale: 1.0 },
  { species: 'turtle', motion: 'traverse', speed: 0.014, speedY: 0.11, cx: 0, cy: 0.68, ax: 0, ay: 0.07, phase: 2.1, scale: 0.72 },
  // Mixed layer: a loose tuna school, passing through rather than lingering.
  { species: 'tuna', motion: 'traverse', speed: 0.05, speedY: 0.21, cx: 0, cy: 0.3, ax: 0, ay: 0.06, phase: 0.0, scale: 1.0 },
  { species: 'tuna', motion: 'traverse', speed: 0.05, speedY: 0.21, cx: 0, cy: 0.38, ax: 0, ay: 0.06, phase: 0.55, scale: 0.82 },
  { species: 'tuna', motion: 'traverse', speed: 0.05, speedY: 0.21, cx: 0, cy: 0.24, ax: 0, ay: 0.06, phase: 1.15, scale: 0.66 },
  // The manta: one, large, very slow, on a wide sweeping arc.
  { species: 'manta', motion: 'patrol', speed: 0.031, speedY: 0.047, cx: 0.5, cy: 0.5, ax: 0.44, ay: 0.2, phase: 1.3, scale: 1.0 },
  // Deep reef: sharks working a long, slow beat.
  { species: 'shark', motion: 'patrol', speed: 0.038, speedY: 0.025, cx: 0.5, cy: 0.42, ax: 0.46, ay: 0.22, phase: 0.4, scale: 1.0 },
  { species: 'shark', motion: 'patrol', speed: 0.029, speedY: 0.061, cx: 0.5, cy: 0.66, ax: 0.38, ay: 0.14, phase: 2.6, scale: 0.75 },
  // The floor: a stingray gliding, barely.
  { species: 'stingray', motion: 'traverse', speed: 0.011, speedY: 0.09, cx: 0, cy: 0.8, ax: 0, ay: 0.04, phase: 1.8, scale: 1.0 },
];

// Every species' normalised path: centred, facing +x, one unit long.
//
// Built lazily on first paint, NOT at module scope. `Path2D` and
// `DOMMatrix` are browser APIs, and tests/water/effects.test.ts imports the
// alpha functions from this module in Node — constructing them eagerly
// makes the whole module unimportable there, which is exactly how this was
// first written and exactly what the test suite caught.
let unitPaths: Record<FaunaSpecies, Path2D> | null = null;

function ensureUnitPaths(): Record<FaunaSpecies, Path2D> {
  if (unitPaths) {
    return unitPaths;
  }
  const paths = {} as Record<FaunaSpecies, Path2D>;
  for (const key of Object.keys(FAUNA_ART) as FaunaSpecies[]) {
    const art = FAUNA_ART[key];
    const unit = new Path2D();
    // Read outermost-first: shrink to unit length, centre the ink, turn the
    // artwork to face +x, flip it if it was drawn nose-left, then bring the
    // viewBox's own centre to the origin.
    const matrix = new DOMMatrix()
      .scale(1 / art.extent)
      .translate(-art.centre[0], -art.centre[1])
      .rotate(art.rotation);
    if (art.mirror) {
      matrix.scaleSelf(-1, 1);
    }
    matrix.translateSelf(-art.viewBox[0] / 2, -art.viewBox[1] / 2);
    unit.addPath(new Path2D(art.d), matrix);
    paths[key] = unit;
  }
  unitPaths = paths;
  return paths;
}

function bandAlpha(band: Band, d: number): number {
  const dial = band.deep ? INTENSITY.faunaDeep : INTENSITY.fauna;
  return dial * ramp(d, band.inFrom, band.inTo) * ramp(d, band.outFrom, band.outTo);
}

/**
 * The strongest LIGHT-water silhouette at `d`, across every light species.
 * This is the envelope the contrast model needs. DRAWING must not use it —
 * each creature is gated by its own species band, and an earlier revision
 * used the envelope for both, which put a ray in the shallows wearing the
 * surface band's alpha.
 */
export function faunaLightAlphaAt(d: number): number {
  let peak = 0;
  for (const key of Object.keys(BANDS) as FaunaSpecies[]) {
    if (!BANDS[key].deep) {
      peak = Math.max(peak, bandAlpha(BANDS[key], d));
    }
  }
  return peak;
}

/** The strongest DARK-water silhouette at `d`. */
export function faunaDeepAlphaAt(d: number): number {
  let peak = 0;
  for (const key of Object.keys(BANDS) as FaunaSpecies[]) {
    if (BANDS[key].deep) {
      peak = Math.max(peak, bandAlpha(BANDS[key], d));
    }
  }
  return peak;
}

/** Whichever treatment is drawn at `d`; for gate-coverage checks only. */
export function faunaAlphaAt(d: number): number {
  return Math.max(faunaLightAlphaAt(d), faunaDeepAlphaAt(d));
}

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/** Position and heading at `t`, from the closed-form path and its derivative. */
function place(c: Creature, t: number, width: number, height: number, margin: number): Placed {
  if (c.motion === 'patrol') {
    const px = c.phase;
    const py = c.phase * 0.7 + 1.1;
    const x = (c.cx + c.ax * Math.sin(t * c.speed + px)) * width;
    const y = (c.cy + c.ay * Math.sin(t * c.speedY + py)) * height;
    const dx = c.ax * c.speed * Math.cos(t * c.speed + px) * width;
    const dy = c.ay * c.speedY * Math.cos(t * c.speedY + py) * height;
    return { x, y, heading: Math.atan2(dy, dx) };
  }
  const span = width + margin * 2;
  const travel = ((c.phase / 6.283 + t * c.speed) % 1 + 1) % 1;
  const x = -margin + travel * span;
  const y = (c.cy + c.ay * Math.sin(t * c.speedY + c.phase)) * height;
  const dx = c.speed * span;
  const dy = c.ay * c.speedY * Math.cos(t * c.speedY + c.phase) * height;
  return { x, y, heading: Math.atan2(dy, dx) };
}

// Two paths, each filled ONCE at one alpha — the same guarantee shoal.ts
// and bubbles.ts rely on. A fill per creature would composite overlaps as
// 1-(1-a)^n rather than the single `a` the contrast bound in
// tests/water/effects.test.ts models. Light and dark treatments are
// separate paths because they are different colours with different bounds,
// and they never coexist behind text: the light species are gone by 20m and
// the dark ones start at 22m, either side of the textless passage.
const fauna: Effect = (frame) => {
  const { ctx, width, height, time } = frame;

  const art = ensureUnitPaths();
  const lightPath = new Path2D();
  const deepPath = new Path2D();
  let maxLightAlpha = 0;
  let maxDeepAlpha = 0;

  for (const c of CREATURES) {
    const band = BANDS[c.species];
    const length = LENGTH[c.species] * c.scale;
    const { x, y, heading } = place(c, time, width, height, length * 1.4);

    const alpha = bandAlpha(band, depthAtY(frame, y));
    if (alpha <= 0) {
      continue;
    }

    const matrix = new DOMMatrix()
      .translate(x, y)
      .rotate((heading * 180) / Math.PI)
      .scale(length);

    (band.deep ? deepPath : lightPath).addPath(art[c.species], matrix);

    if (band.deep) {
      maxDeepAlpha = Math.max(maxDeepAlpha, alpha);
    } else {
      maxLightAlpha = Math.max(maxLightAlpha, alpha);
    }
  }

  if (maxLightAlpha <= 0 && maxDeepAlpha <= 0) {
    return;
  }

  ctx.save();
  if (maxLightAlpha > 0) {
    ctx.globalAlpha = maxLightAlpha;
    ctx.fillStyle = `rgb(${LIGHT_SILHOUETTE[0]}, ${LIGHT_SILHOUETTE[1]}, ${LIGHT_SILHOUETTE[2]})`;
    ctx.fill(lightPath);
  }
  if (maxDeepAlpha > 0) {
    ctx.globalAlpha = maxDeepAlpha;
    ctx.fillStyle = `rgb(${DEEP_SILHOUETTE[0]}, ${DEEP_SILHOUETTE[1]}, ${DEEP_SILHOUETTE[2]})`;
    ctx.fill(deepPath);
  }
  ctx.restore();
};

export default fauna;
