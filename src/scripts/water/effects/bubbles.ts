// Sparse bubbles rising through mid-water. Closed-form: each bubble's
// position at time `t` is computed from `t` and the bubble's own seed alone
// — see snow.ts's header comment for why that matters.

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';

const BUBBLE_COUNT = 10;
const GOLDEN = 0.6180339887;
// A second, independent irrational multiplier for the wander phase (see
// below) — without it, phase is a fixed function of seedX and the whole
// field shears as one coherent travelling wave instead of wandering
// independently.
const GOLDEN_2 = 0.7548776662;

// Dark-rimmed against bright water — a pale bubble on near-white water is
// invisible, the same lesson 5a already paid for when caustics were drawn
// with 'screen'. Same silhouette colour as the shoal.
const COLOUR: readonly [number, number, number] = [40, 72, 88];

const RADIUS_MIN = 1.5;
const RADIUS_MAX = 4;
const RISE_SPEED_MIN = 0.03; // viewport heights / second
const RISE_SPEED_MAX = 0.06;
const WOBBLE_FREQ = 1.1;
const WOBBLE_AMPLITUDE = 5; // px

// In from 5m, full 7-13m, gone by 17m — the fade-down is deliberately
// earlier than the shoal's (19m) so the two don't stack at their peaks.
const FADE_IN_FROM = 5;
const FADE_IN_TO = 7;
const FADE_OUT_FROM = 17;
const FADE_OUT_TO = 13;

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

/** Peak alpha a bubble at depth `d` may draw at. */
export function bubbleAlphaAt(d: number): number {
  return (
    INTENSITY.bubbles * ramp(d, FADE_IN_FROM, FADE_IN_TO) * ramp(d, FADE_OUT_FROM, FADE_OUT_TO)
  );
}

// Same reasoning as shoal.ts: a separate ctx.stroke() per bubble composites
// overlapping rings as 1 - (1-a)^n, not the single `a` the contrast budget
// assumes. Fixed the same way — every bubble's ring goes into ONE path,
// stroked ONCE at the MAX of this frame's gated alphas (always a value
// bubbleAlphaAt can genuinely return, so it never exceeds the
// analytically-verified bound). moveTo to each ring's own start point
// before its arc() — arc() with a full 0..2*PI sweep returns exactly to
// its start point, so the next moveTo begins a clean new sub-path with no
// connecting segment between bubbles (unlike a plain fill, a stray
// connecting line WOULD render as a visible stroke here).
const bubbles: Effect = (frame) => {
  const { ctx, width, height, time } = frame;

  let maxAlpha = 0;
  let anyVisible = false;

  ctx.beginPath();
  for (const b of BUBBLES) {
    const y = (1 - wrap01(b.seedY + time * b.riseSpeed)) * height;
    const x = b.seedX * width + Math.sin(time * WOBBLE_FREQ + b.phase) * WOBBLE_AMPLITUDE;

    const alpha = bubbleAlphaAt(depthAtY(frame, y));
    if (alpha <= 0) {
      continue;
    }

    ctx.moveTo(x + b.radius, y);
    ctx.arc(x, y, b.radius, 0, Math.PI * 2);

    if (alpha > maxAlpha) {
      maxAlpha = alpha;
    }
    anyVisible = true;
  }

  if (!anyVisible) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = maxAlpha;
  ctx.strokeStyle = `rgb(${COLOUR[0]}, ${COLOUR[1]}, ${COLOUR[2]})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
};

export default bubbles;
