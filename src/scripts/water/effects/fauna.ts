// Marine life through the column, placed at the depth each animal is
// actually encountered at: turtles and dolphins near the surface, an eagle
// ray in open mid-water, reef sharks below the thermocline. Phase 9 — the
// surface band (0-5m) previously held nothing but caustics, shafts and
// dither, since bubbles start at 5m and the shoal at 8m, and it read as
// plain.
//
// SIZE CAP, and why it exists. PRODUCT.md records a standing rule: a marine
// silhouette "must not be freehand-authored as bezier curves — an
// approximated organic contour reads worse than omitting the effect". That
// rule is about a single LARGE silhouette, and it is right. What makes it
// safe to author these procedurally is scale: at 45px and below a turtle is
// an oval with four flippers and your eye fills in the rest, which is
// genuinely what you see at distance in real water. Above that the contour
// becomes legible enough to read as a drawing. So MAX_LENGTH is a hard cap,
// not a tuning value — the large manta pass PRODUCT.md wants stays deferred
// until there is a real asset to draw it from.
//
// Closed-form in `time`, like every other effect here: no integrated state,
// so the reduced-motion frame at time = 0 is a real composed frame. See
// snow.ts's header for the full reasoning.

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';

// The hard cap described above. Nothing here may exceed it.
const MAX_LENGTH = 45;

// Light-water silhouette: the same blue-grey the shoal uses. Against
// near-white surface water a creature reads as a dark shape, which is what
// it is.
const LIGHT_SILHOUETTE: readonly [number, number, number] = [40, 72, 88];

// Dark-water silhouette: palette.ts's own deepest stop (32m). Below the
// thermocline a creature is DARKER than the water behind it, not lighter —
// there is no light down there to catch. That also makes this layer free:
// darkening already-dark water RAISES contrast for the on-deep tokens, so
// unlike the surface layer it spends no headroom at all. It fades toward
// nothing by 30m because by then the water has reached this colour and
// there is no longer any difference to draw.
const DEEP_SILHOUETTE: readonly [number, number, number] = [11, 42, 58];

// Surface band: turtles surface to breathe every few minutes and dolphins
// are surface-associated, so this is where you actually meet them.
const SURFACE_FADE_IN_FROM = 0.5;
const SURFACE_FADE_IN_TO = 2;
const SURFACE_FADE_OUT_FROM = 11;
const SURFACE_FADE_OUT_TO = 8;

// Open mid-water: an eagle ray cruises roughly 5-30m; here it shares the
// band the shoal already occupies.
const MID_FADE_IN_FROM = 10;
const MID_FADE_IN_TO = 12;
const MID_FADE_OUT_FROM = 19;
const MID_FADE_OUT_TO = 17;

// Below the thermocline: reef sharks are characteristic of 15-30m walls.
// Starts at 21m (THERMOCLINE) and is gone by 30m, where the water has
// darkened to DEEP_SILHOUETTE and nothing would show anyway.
const DEEP_FADE_IN_FROM = 21;
const DEEP_FADE_IN_TO = 24;
const DEEP_FADE_OUT_FROM = 30;
const DEEP_FADE_OUT_TO = 27;

const GOLDEN = 0.6180339887;

function fract(v: number): number {
  return v - Math.floor(v);
}

/** JS `%` can return a negative result; this never does. */
function wrap01(v: number): number {
  return ((v % 1) + 1) % 1;
}

type Species = 'turtle' | 'dolphin' | 'ray' | 'shark';

interface Creature {
  readonly species: Species;
  /** Fraction of viewport width travelled per second. Signed: direction. */
  readonly speed: number;
  /** Start position along the traverse, 0-1. */
  readonly offset: number;
  /** Vertical position as a fraction of the viewport, 0-1. */
  readonly lane: number;
  /** Amplitude of the vertical bob, as a fraction of viewport height. */
  readonly bob: number;
  readonly bobFreq: number;
  readonly phase: number;
  readonly length: number;
}

// Deliberately few. PRODUCT.md asks for "a presence rather than
// decoration", and a column that is busy at every depth reads as an
// aquarium rather than a dive.
const CREATURES: readonly Creature[] = [
  // Surface — two turtles, unhurried and on different lanes.
  { species: 'turtle', speed: 0.016, offset: 0.1, lane: 0.22, bob: 0.012, bobFreq: 0.21, phase: 0.0, length: 34 },
  { species: 'turtle', speed: -0.012, offset: 0.7, lane: 0.63, bob: 0.01, bobFreq: 0.17, phase: 2.1, length: 29 },
  // Surface — a dolphin pair, faster, travelling together with a small lag.
  { species: 'dolphin', speed: 0.042, offset: 0.35, lane: 0.4, bob: 0.02, bobFreq: 0.33, phase: 0.0, length: 44 },
  { species: 'dolphin', speed: 0.042, offset: 0.29, lane: 0.45, bob: 0.02, bobFreq: 0.33, phase: 0.5, length: 38 },
  // Open mid-water — one eagle ray, gliding.
  { species: 'ray', speed: 0.018, offset: 0.55, lane: 0.52, bob: 0.014, bobFreq: 0.13, phase: 1.3, length: 40 },
  // Below the thermocline — reef sharks, slow and steady.
  { species: 'shark', speed: -0.02, offset: 0.2, lane: 0.35, bob: 0.008, bobFreq: 0.11, phase: 0.4, length: 42 },
  { species: 'shark', speed: 0.015, offset: 0.8, lane: 0.72, bob: 0.007, bobFreq: 0.09, phase: 2.6, length: 36 },
];

/** Surface band only — turtles and dolphins. */
function surfaceAlphaAt(d: number): number {
  return (
    INTENSITY.fauna *
    ramp(d, SURFACE_FADE_IN_FROM, SURFACE_FADE_IN_TO) *
    ramp(d, SURFACE_FADE_OUT_FROM, SURFACE_FADE_OUT_TO)
  );
}

/** Open mid-water only — the eagle ray. */
function midAlphaAt(d: number): number {
  return (
    INTENSITY.fauna *
    ramp(d, MID_FADE_IN_FROM, MID_FADE_IN_TO) *
    ramp(d, MID_FADE_OUT_FROM, MID_FADE_OUT_TO)
  );
}

/**
 * The strongest LIGHT-water silhouette at `d`, across both light bands.
 * This is the bound the contrast model needs — it is deliberately the
 * envelope of the two bands rather than either one, so the model stays
 * correct however the species are distributed between them. DRAWING must
 * not use it: each species is gated by its own band (see `alphaFor`), and
 * an earlier revision of this file used the envelope for both, which put
 * the eagle ray at 2.6m wearing the surface band's alpha.
 */
export function faunaLightAlphaAt(d: number): number {
  return Math.max(surfaceAlphaAt(d), midAlphaAt(d));
}

/** Peak alpha of the DARK-water silhouettes (reef sharks). */
export function faunaDeepAlphaAt(d: number): number {
  return (
    INTENSITY.faunaDeep *
    ramp(d, DEEP_FADE_IN_FROM, DEEP_FADE_IN_TO) *
    ramp(d, DEEP_FADE_OUT_FROM, DEEP_FADE_OUT_TO)
  );
}

/** Whichever treatment is drawn at `d`; for gate-coverage checks only. */
export function faunaAlphaAt(d: number): number {
  return Math.max(faunaLightAlphaAt(d), faunaDeepAlphaAt(d));
}

/** The gated alpha for one creature's OWN band — never the envelope. */
function alphaFor(species: Species, depth: number): number {
  switch (species) {
    case 'shark':
      return faunaDeepAlphaAt(depth);
    case 'ray':
      return midAlphaAt(depth);
    default:
      return surfaceAlphaAt(depth);
  }
}

// Each shape is drawn into `path` around the origin, pointing +x, then
// placed by the caller's transform. Kept to primitives — ellipse, lines and
// one quadratic — because at this scale that is all that survives anyway.

// Every body is built from ELLIPSES rather than chained quadratic curves.
// The first pass used quadratics and both shapes failed in exactly the way
// PRODUCT.md warns about: the dolphin's outline collapsed into an arrowhead
// and the turtle's flippers rendered as spikes off a lumpy mass. An ellipse
// cannot collapse — it is the same shape at every size — so at 30-45px it
// degrades into "a rounded body" rather than into a wrong shape.

/** Adds a rotated ellipse as its own sub-path. */
function blob(path: Path2D, x: number, y: number, rx: number, ry: number, rot: number): void {
  path.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  path.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

// Seen from above, which is how you meet a turtle at the surface: a broad
// shell, two large wing-like fore flippers, two small hind ones, and a head.
// The fore flippers are the whole silhouette — a green turtle's are nearly
// as long as its shell, and the first pass had them at a third of that.
function turtle(path: Path2D, L: number, t: number, phase: number): void {
  const beat = Math.sin(t * 0.9 + phase) * 0.28; // radians
  blob(path, 0, 0, L * 0.3, L * 0.25, 0); // carapace
  blob(path, L * 0.37, 0, L * 0.1, L * 0.075, 0); // head
  // Fore flippers: long, broad, swept back, beating slowly.
  blob(path, L * 0.02, -L * 0.28, L * 0.29, L * 0.085, -0.55 + beat);
  blob(path, L * 0.02, L * 0.28, L * 0.29, L * 0.085, 0.55 - beat);
  // Hind flippers: short and blunt.
  blob(path, -L * 0.26, -L * 0.2, L * 0.15, L * 0.065, -0.35 + beat * 0.4);
  blob(path, -L * 0.26, L * 0.2, L * 0.15, L * 0.065, 0.35 - beat * 0.4);
}

// Side view. A fusiform body — widest about a third back from the snout —
// a modest swept dorsal, one pectoral, and a horizontal fluke. The first
// pass gave the dorsal twice the body's height, which is most of why it
// read as an arrow.
function dolphin(path: Path2D, L: number, t: number, phase: number): void {
  const h = L * 0.15;
  const flex = Math.sin(t * 1.6 + phase) * (h * 0.35);
  blob(path, 0, 0, L * 0.42, h, 0); // body
  blob(path, L * 0.4, -h * 0.1, L * 0.12, h * 0.42, -0.12); // rostrum + melon
  // Dorsal: swept back, and only about half the body's depth.
  path.moveTo(L * 0.04, -h * 0.75);
  path.lineTo(-L * 0.12, -h * 1.75);
  path.lineTo(-L * 0.14, -h * 0.6);
  path.closePath();
  // Pectoral.
  path.moveTo(L * 0.16, h * 0.5);
  path.lineTo(L * 0.0, h * 1.5);
  path.lineTo(L * 0.06, h * 0.45);
  path.closePath();
  // Peduncle and fluke — horizontal lobes, the dolphin's tell against a
  // fish's vertical tail.
  blob(path, -L * 0.44, flex * 0.5, L * 0.1, h * 0.3, 0);
  path.moveTo(-L * 0.48, flex * 0.8);
  path.lineTo(-L * 0.62, -h * 0.95 + flex);
  path.lineTo(-L * 0.56, flex * 0.9);
  path.lineTo(-L * 0.62, h * 0.95 + flex);
  path.closePath();
}

// Side view, and the same construction as the dolphin with three changes
// that are the actual difference in silhouette: a taller first dorsal, a
// blunter snout, and a heterocercal tail whose upper lobe is clearly longer.
function shark(path: Path2D, L: number, t: number, phase: number): void {
  const h = L * 0.15;
  const sweep = Math.sin(t * 1.1 + phase) * (h * 0.5);
  blob(path, 0, 0, L * 0.4, h, 0); // body
  blob(path, L * 0.34, h * 0.06, L * 0.14, h * 0.62, 0.06); // snout, blunter
  // First dorsal — tall and triangular, the thing that says "shark".
  path.moveTo(L * 0.06, -h * 0.8);
  path.lineTo(-L * 0.06, -h * 2.2);
  path.lineTo(-L * 0.18, -h * 0.7);
  path.closePath();
  // Pectorals, long and swept.
  path.moveTo(L * 0.14, h * 0.55);
  path.lineTo(-L * 0.08, h * 1.9);
  path.lineTo(L * 0.02, h * 0.5);
  path.closePath();
  // Small second dorsal, well back.
  path.moveTo(-L * 0.26, -h * 0.7);
  path.lineTo(-L * 0.33, -h * 1.15);
  path.lineTo(-L * 0.36, -h * 0.65);
  path.closePath();
  // Caudal fin: upper lobe markedly longer than the lower.
  path.moveTo(-L * 0.38, sweep * 0.8);
  path.lineTo(-L * 0.58, -h * 1.9 + sweep);
  path.lineTo(-L * 0.5, sweep * 0.9);
  path.lineTo(-L * 0.56, h * 0.85 + sweep);
  path.closePath();
}

// Seen from above. A ray's disc is genuinely wider than it is long, so the
// ellipse does most of the work here — the wings flap by rotating two
// outboard lobes rather than by deforming a curve.
function eagleRay(path: Path2D, L: number, t: number, phase: number): void {
  const flap = Math.sin(t * 0.7 + phase) * 0.3; // radians
  blob(path, 0, 0, L * 0.26, L * 0.22, 0); // central disc
  // Wings sit at 0.22L from centre against a 0.22L disc radius, so they
  // OVERLAP it rather than abutting — an earlier revision placed them at
  // 0.3L, exactly where the disc ends, and the ray rendered as three
  // separate blobs. Sub-paths only merge where they actually overlap.
  blob(path, -L * 0.02, -L * 0.22, L * 0.22, L * 0.115, -0.25 + flap);
  blob(path, -L * 0.02, L * 0.22, L * 0.22, L * 0.115, 0.25 - flap);
  blob(path, L * 0.24, 0, L * 0.1, L * 0.08, 0); // snout
  // Whip tail, longer than the body — the eagle ray's signature.
  path.moveTo(-L * 0.2, -L * 0.018);
  path.lineTo(-L * 0.78, -L * 0.006 + flap * L * 0.05);
  path.lineTo(-L * 0.78, L * 0.006 + flap * L * 0.05);
  path.lineTo(-L * 0.2, L * 0.018);
  path.closePath();
}

const SHAPES: Record<Species, (p: Path2D, L: number, t: number, ph: number) => void> = {
  turtle,
  dolphin,
  ray: eagleRay,
  shark,
};

// Two paths, each filled ONCE at one alpha — the same guarantee shoal.ts
// and bubbles.ts rely on. A fill per creature would composite overlaps as
// 1-(1-a)^n rather than the single `a` the contrast bound in
// tests/water/effects.test.ts models. Light and dark treatments are
// separate paths because they are different colours with different bounds,
// and they never coexist behind text: the light band is gone by 11m and the
// dark one starts at 21m.
const fauna: Effect = (frame) => {
  const { ctx, width, height, time } = frame;

  const lightPath = new Path2D();
  const deepPath = new Path2D();
  let maxLightAlpha = 0;
  let maxDeepAlpha = 0;

  for (let i = 0; i < CREATURES.length; i++) {
    const c = CREATURES[i];
    const length = Math.min(c.length, MAX_LENGTH);

    // Traverse wraps across the viewport with a margin either side, so a
    // creature enters and leaves rather than popping at the edge.
    const margin = length * 1.6;
    const span = width + margin * 2;
    const travel = wrap01(c.offset + time * c.speed);
    const x = -margin + travel * span;
    const y = (c.lane + Math.sin(time * c.bobFreq + c.phase) * c.bob) * height;

    const depth = depthAtY(frame, y);
    const alpha = alphaFor(c.species, depth);
    if (alpha <= 0) {
      continue;
    }

    // Heading: creatures face the way they travel, and tilt slightly with
    // the bob so they do not look like decals sliding sideways.
    const dydt = Math.cos(time * c.bobFreq + c.phase) * c.bob * c.bobFreq * height;
    const dxdt = c.speed * span;
    const angle = Math.atan2(dydt, dxdt);

    const shaped = new Path2D();
    SHAPES[c.species](shaped, length, time, c.phase + i);

    const placed = new Path2D();
    placed.addPath(shaped, {
      a: Math.cos(angle),
      b: Math.sin(angle),
      c: -Math.sin(angle),
      d: Math.cos(angle),
      e: x,
      f: y,
    } as DOMMatrix2DInit);

    if (c.species === 'shark') {
      deepPath.addPath(placed);
      maxDeepAlpha = Math.max(maxDeepAlpha, alpha);
    } else {
      lightPath.addPath(placed);
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
