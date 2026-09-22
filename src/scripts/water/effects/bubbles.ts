// Sparse bubbles rising through mid-water. Closed-form: each bubble's
// position at time `t` is computed from `t` and the bubble's own seed alone
// — see snow.ts's header comment for why that matters.

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';

// Phase 7: more and larger, same treatment as shoal.ts — still one path,
// one stroke (see the comment above `bubbles` below), so more of them costs
// nothing on the contrast bound. 26, matching the mockup's own bubble count.
const BUBBLE_COUNT = 26;
const GOLDEN = 0.6180339887;
// A second, independent irrational multiplier for the wander phase (see
// below) — without it, phase is a fixed function of seedX and the whole
// field shears as one coherent travelling wave instead of wandering
// independently.
const GOLDEN_2 = 0.7548776662;

// Dark-rimmed against bright water — a pale bubble on near-white water is
// invisible, the same lesson 5a already paid for when caustics were drawn
// with 'screen'. Same silhouette colour as the shoal.
const RIM_COLOUR: readonly [number, number, number] = [40, 72, 88];

// The specular glint, and the whole reason a bubble reads as a bubble
// rather than as a drawn ring. Phase 9: this used to be RIM_COLOUR, so
// every bubble was a dark circle with a dark dot inside it — the "too
// fake" the user reported. A real bubble against bright water is a
// dark-rimmed lens with a BRIGHT highlight where the surface catches the
// light, which is exactly what the mockup draws (#F2FBFD).
//
// Contrast note: bubbles are gated to 5-17m, entirely within the light
// zone, so this can only ever brighten already-light water. Brightening
// RAISES contrast for the dark ink that zone renders, so the glint cannot
// breach the analytical bound in tests/water/effects.test.ts no matter its
// alpha — which is why only the rim is modelled there.
const GLINT_COLOUR: readonly [number, number, number] = [242, 251, 253];

// The mockup's own range. Phase 9 shrank these from 2.5-7: at that size the
// rings read as deliberate graphic circles rather than bubbles.
const RADIUS_MIN = 1.2;
const RADIUS_MAX = 4.8;
const RISE_SPEED_MIN = 0.03; // viewport heights / second
const RISE_SPEED_MAX = 0.06;
const WOBBLE_FREQ = 1.1;
const WOBBLE_AMPLITUDE = 5; // px

// Phase 9: bubbles now run to the FLOOR of the column, as the mockup's do
// (its gate ramps in and never fades out). They used to stop at 17m, which
// is why they never looked real: a bubble is a dark-rimmed lens against
// bright water and a BRIGHT ring against dark water, and we only ever
// showed the first, weaker case. The bright-on-dark half is the one that
// reads.
//
// The two treatments hand over across 19-24m — the unclaimed thermocline
// passage, which by construction carries no text on any page (see
// depth.ts's band table). So a dark rim and a bright ring can never both
// sit behind the same glyph, and each zone's bound stays independent.
const FADE_IN_FROM = 5;
const FADE_IN_TO = 7;
// The handover. `ramp(d, 24, 19)` is 1 above 19m and 0 below 24m; its
// mirror `ramp(d, 19, 24)` is the complement.
const HANDOVER_SHALLOW = 19;
const HANDOVER_DEEP = 24;

function fract(v: number): number {
  return v - Math.floor(v);
}

/** JS `%` can return a negative result; this never does. */
function wrap01(v: number): number {
  return ((v % 1) + 1) % 1;
}

interface Bubble {
  readonly seedX: number;
  readonly seedY: number;
  readonly radius: number;
  readonly riseSpeed: number;
  readonly phase: number;
}

// Built once at module scope, not per frame.
const BUBBLES: readonly Bubble[] = Array.from({ length: BUBBLE_COUNT }, (_, i) => ({
  seedX: fract(i * GOLDEN + 0.05),
  seedY: fract(i * GOLDEN * 2 + 0.29),
  radius: RADIUS_MIN + fract(i * GOLDEN + 0.53) * (RADIUS_MAX - RADIUS_MIN),
  riseSpeed: RISE_SPEED_MIN + fract(i * GOLDEN + 0.19) * (RISE_SPEED_MAX - RISE_SPEED_MIN),
  phase: fract(i * GOLDEN_2 + 0.81) * Math.PI * 2,
}));

/**
 * Peak alpha of a DARK-rimmed bubble at depth `d` — the light-water
 * treatment. Composites toward RIM_COLOUR, so this is what the light-zone
 * contrast bound must model.
 */
export function bubbleLightAlphaAt(d: number): number {
  return (
    INTENSITY.bubbles *
    ramp(d, FADE_IN_FROM, FADE_IN_TO) *
    ramp(d, HANDOVER_DEEP, HANDOVER_SHALLOW)
  );
}

/**
 * Peak alpha of a BRIGHT bubble at depth `d` — the dark-water treatment.
 * Composites toward GLINT_COLOUR, so this is what the DEEP contrast bound
 * must model. Deliberately far lower than the light-zone value: bright on
 * dark has much more contrast to work with, so it reads at a fraction of
 * the alpha, and the deep zone is where snow is already spending headroom.
 */
export function bubbleDeepAlphaAt(d: number): number {
  return INTENSITY.bubblesDeep * ramp(d, HANDOVER_SHALLOW, HANDOVER_DEEP);
}

/**
 * The larger of the two treatments at `d`. Only for "is anything drawn
 * here" gate-coverage checks — it says nothing about which COLOUR is
 * composited, so a contrast model must use the two functions above rather
 * than this one.
 */
export function bubbleAlphaAt(d: number): number {
  return Math.max(bubbleLightAlphaAt(d), bubbleDeepAlphaAt(d));
}

// Mockup draws each bubble as a ring plus a small interior highlight dot
// (alpha*fade*0.75 and alpha*fade*0.22 respectively) — reproduced here as a
// SECOND single-path fill, not a per-bubble draw call: the highlight dot
// sits well inside its own ring (offset and at 0.42x the radius, same
// fractions the mockup uses), so the two shapes' pixels never overlap, and
// each is still accumulated into one path and painted once at one alpha —
// the same guarantee the ring itself relies on (see the comment above
// `bubbles` below). HIGHLIGHT_ALPHA_RATIO caps the dot's alpha well under
// maxAlpha (never above it), so it can only ever be a fraction of the
// already-verified bound, never exceed it.
const HIGHLIGHT_ALPHA_RATIO = 0.22 / 0.75;
const HIGHLIGHT_RADIUS_RATIO = 0.42;
const HIGHLIGHT_OFFSET_RATIO = 0.3;

// Bubbles used to appear and vanish abruptly at the viewport edges, which
// is the other half of why they read as fake. The mockup fades them with a
// per-bubble alpha; we cannot, because every ring is stroked ONCE at a
// single alpha to keep the contrast guarantee below. So fade the RADIUS
// instead — a bubble that shrinks to nothing reads as naturally as one that
// dims, and radius is per-bubble geometry rather than per-bubble alpha, so
// the single-stroke guarantee is untouched. In at the bottom faster than
// out at the top, matching the mockup's own 4/6 asymmetry.
const EDGE_FADE_IN = 4;
const EDGE_FADE_OUT = 6;
// Below this the arc is sub-pixel and only costs path nodes.
const MIN_DRAWN_RADIUS = 0.3;

// Same reasoning as shoal.ts: a separate ctx.stroke() per bubble composites
// overlapping rings as 1 - (1-a)^n, not the single `a` the contrast budget
// assumes. Fixed the same way — every bubble's ring goes into ONE path,
// stroked ONCE at the MAX of this frame's gated alphas (always a value
// bubbleAlphaAt can genuinely return, so it never exceeds the
// analytically-verified bound); every bubble's highlight dot goes into a
// SECOND path, filled once at a fraction of that same alpha. moveTo to each
// ring's own start point before its arc() — arc() with a full 0..2*PI sweep
// returns exactly to its start point, so the next moveTo begins a clean new
// sub-path with no connecting segment between bubbles (unlike a plain fill,
// a stray connecting line WOULD render as a visible stroke here).
const bubbles: Effect = (frame) => {
  const { ctx, width, height, time } = frame;

  // Three paths, each stroked or filled exactly ONCE at one alpha, for the
  // same reason shoal.ts uses one: a draw call per bubble would composite
  // overlapping rings as 1-(1-a)^n rather than the single `a` the contrast
  // bound assumes. Dark rims and bright rings are separate paths because
  // they are different colours with different bounds — and they only ever
  // coexist across 19-24m, which carries no text.
  const rims = new Path2D();
  const rings = new Path2D();
  const glints = new Path2D();
  let maxRimAlpha = 0;
  let maxRingAlpha = 0;

  for (const b of BUBBLES) {
    const progress = wrap01(b.seedY + time * b.riseSpeed);
    const y = (1 - progress) * height;
    const x = b.seedX * width + Math.sin(time * WOBBLE_FREQ + b.phase) * WOBBLE_AMPLITUDE;

    const depth = depthAtY(frame, y);
    const rimAlpha = bubbleLightAlphaAt(depth);
    const ringAlpha = bubbleDeepAlphaAt(depth);
    if (rimAlpha <= 0 && ringAlpha <= 0) {
      continue;
    }

    // `progress` runs 0 at the bottom of the viewport to 1 at the top, the
    // direction a bubble travels, so fade in against progress and out
    // against its complement.
    const edgeFade = Math.min(1, progress * EDGE_FADE_IN, (1 - progress) * EDGE_FADE_OUT);
    const radius = b.radius * edgeFade;
    if (radius < MIN_DRAWN_RADIUS) {
      continue;
    }

    if (rimAlpha > 0) {
      rims.moveTo(x + radius, y);
      rims.arc(x, y, radius, 0, Math.PI * 2);
      maxRimAlpha = Math.max(maxRimAlpha, rimAlpha);
    }

    if (ringAlpha > 0) {
      rings.moveTo(x + radius, y);
      rings.arc(x, y, radius, 0, Math.PI * 2);
      maxRingAlpha = Math.max(maxRingAlpha, ringAlpha);

      // The glint only exists on the dark-water treatment. Against bright
      // water a near-white highlight is invisible by construction, so
      // drawing one there costs path nodes and buys nothing.
      const hx = x - radius * HIGHLIGHT_OFFSET_RATIO;
      const hy = y - radius * HIGHLIGHT_OFFSET_RATIO;
      const hr = radius * HIGHLIGHT_RADIUS_RATIO;
      glints.moveTo(hx + hr, hy);
      glints.arc(hx, hy, hr, 0, Math.PI * 2);
    }
  }

  if (maxRimAlpha <= 0 && maxRingAlpha <= 0) {
    return;
  }

  ctx.save();
  ctx.lineWidth = 0.9; // the mockup's own weight; 1 read as a drawn outline

  if (maxRimAlpha > 0) {
    ctx.globalAlpha = maxRimAlpha;
    ctx.strokeStyle = `rgb(${RIM_COLOUR[0]}, ${RIM_COLOUR[1]}, ${RIM_COLOUR[2]})`;
    ctx.stroke(rims);
  }

  if (maxRingAlpha > 0) {
    const glint = `rgb(${GLINT_COLOUR[0]}, ${GLINT_COLOUR[1]}, ${GLINT_COLOUR[2]})`;
    ctx.globalAlpha = maxRingAlpha;
    ctx.strokeStyle = glint;
    ctx.stroke(rings);

    ctx.globalAlpha = maxRingAlpha * HIGHLIGHT_ALPHA_RATIO;
    ctx.fillStyle = glint;
    ctx.fill(glints);
  }

  ctx.restore();
};

export default bubbles;
