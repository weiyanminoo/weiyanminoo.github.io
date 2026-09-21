// A shoal of fish: closed-form lead-and-lag. One leader on a deterministic
// path; fish `i` sits where the leader was `lag_i` seconds ago, plus a small
// per-fish offset. That is lead-and-lag by construction — no simulation, no
// per-frame integrated state — and is exact at any `time`, including 0 (the
// reduced-motion static frame).

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';

const FISH_COUNT = 24;
const GOLDEN = 0.6180339887;
// A second, independent irrational multiplier — used wherever a quantity
// must NOT move in lockstep with another quantity already seeded from
// GOLDEN (see offsetX below), so the two don't correlate into a single
// coherent wave.
const GOLDEN_2 = 0.7548776662;

// Dark against light mid-water — a silhouette is the only way this reads
// there. No new colours beyond palette.ts: this is the brief's one
// exception, the dark blue-grey for silhouettes.
const COLOUR: readonly [number, number, number] = [40, 72, 88];

const LEAD_X_AMPLITUDE = 0.4;
const LEAD_X_FREQ = 0.055;
const LEAD_Y_AMPLITUDE = 0.12;
const LEAD_Y_FREQ = 0.083;
const LEAD_Y_PHASE = 1.1;

const OFFSET_RANGE_X = 10; // px, per-fish spread around the leader
const OFFSET_RANGE_Y = 4; // px
const BREATH_FREQ = 0.03; // low-frequency wobble so the shoal isn't a rigid string
const BREATH_AMPLITUDE = 2; // px

const LENGTH_MIN = 4;
const LENGTH_MAX = 7;
const WIDTH_PX = 1.6;

// Fades in from 8m, full 11-14m, gone by 19m.
const FADE_IN_FROM = 8;
const FADE_IN_TO = 11;
const FADE_OUT_FROM = 19;
const FADE_OUT_TO = 14;

function fract(v: number): number {
  return v - Math.floor(v);
}

interface Fish {
  readonly lag: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly breathPhase: number;
  readonly length: number;
}

// Built once at module scope, not per frame. offsetX is seeded from GOLDEN_2,
// not GOLDEN, so it doesn't move in lockstep with lag (which is itself
// jittered by fract(i * GOLDEN)) — otherwise lag jitter and x-offset are
// perfectly correlated across the shoal.
const FISH: readonly Fish[] = Array.from({ length: FISH_COUNT }, (_, i) => ({
  lag: i * 0.22 + 0.15 * fract(i * GOLDEN),
  offsetX: (fract(i * GOLDEN_2) - 0.5) * 2 * OFFSET_RANGE_X,
  offsetY: (fract(i * GOLDEN * 2 + 0.17) - 0.5) * 2 * OFFSET_RANGE_Y,
  breathPhase: fract(i * GOLDEN + 0.41) * Math.PI * 2,
  length: LENGTH_MIN + fract(i * GOLDEN + 0.73) * (LENGTH_MAX - LENGTH_MIN),
}));

function leadX(t: number, width: number): number {
  return width * (0.5 + LEAD_X_AMPLITUDE * Math.sin(t * LEAD_X_FREQ));
}

function leadY(t: number, height: number): number {
  return height * (0.5 + LEAD_Y_AMPLITUDE * Math.sin(t * LEAD_Y_FREQ + LEAD_Y_PHASE));
}

/** Peak alpha a fish at depth `d` may draw at. */
export function shoalAlphaAt(d: number): number {
  return (
    INTENSITY.shoal * ramp(d, FADE_IN_FROM, FADE_IN_TO) * ramp(d, FADE_OUT_FROM, FADE_OUT_TO)
  );
}

// Fish are strung ~7px apart along one leader path while being 4-7px long,
// so at typical lag spacing (and near a turn, where the whole tail
// collapses toward the leader) several fish overlap in the same frame. A
// separate ctx.fill() per fish would composite overlaps as 1 - (1-a)^n,
// not the single `a` the contrast budget (and tests/water/effects.test.ts's
// stackedColourAt) assumes. Fixed by construction, not by measurement:
// every fish's ellipse is accumulated into ONE path and filled ONCE, at ONE
// alpha, so canvas's fill rule composites the whole cluster as a single
// shape no matter how much its members overlap — n = 1 always, structurally.
//
// That one alpha is the MAX of the individual fish's gated alphas this
// frame, not an average or a fixed cluster-depth lookup: every included
// fish already passed its own shoalAlphaAt(depth) > 0 gate below, so the
// max is always one specific value that function can genuinely return —
// exactly the peak tests/water/effects.test.ts already sweeps over — so
// this can never exceed the analytically-verified bound. It can make a
// fish at the dim edge of the gate render brighter than its own individual
// alpha would, but the shoal spans well under 50px vertically in practice
// (offsets + breathing are single-digit px; lag-induced leadY drift is the
// only large contributor), so that difference is small.
const shoal: Effect = (frame) => {
  const { ctx, width, height, time } = frame;

  let maxAlpha = 0;
  let anyVisible = false;

  ctx.beginPath();
  for (const fish of FISH) {
    const tLag = time - fish.lag;
    const breathe = Math.sin(time * BREATH_FREQ + fish.breathPhase) * BREATH_AMPLITUDE;
    const x = leadX(tLag, width) + fish.offsetX + breathe;
    const y = leadY(tLag, height) + fish.offsetY;

    // Fish that land outside the viewport are simply not drawn — no wrap.
    if (x < 0 || x > width || y < 0 || y > height) {
      continue;
    }

    const alpha = shoalAlphaAt(depthAtY(frame, y));
    if (alpha <= 0) {
      continue;
    }

    // Heading from the leader's own velocity at t - lag: the sign of
    // cos(...) from leadX is enough to know when the shoal turns, and the
    // matching leadY term gives the small vertical tilt for free.
    const dxdt = LEAD_X_AMPLITUDE * LEAD_X_FREQ * Math.cos(tLag * LEAD_X_FREQ) * width;
    const dydt =
      LEAD_Y_AMPLITUDE * LEAD_Y_FREQ * Math.cos(tLag * LEAD_Y_FREQ + LEAD_Y_PHASE) * height;
    const angle = Math.atan2(dydt, dxdt);
    const rx = fish.length / 2;

    // moveTo to the ellipse's own start point before each one, so canvas
    // does not implicitly connect it to the previous fish's end point with
    // a stray line segment — each fish stays its own disjoint sub-path.
    ctx.moveTo(x + rx * Math.cos(angle), y + rx * Math.sin(angle));
    ctx.ellipse(x, y, rx, WIDTH_PX / 2, angle, 0, Math.PI * 2);

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
  ctx.fillStyle = `rgb(${COLOUR[0]}, ${COLOUR[1]}, ${COLOUR[2]})`;
  ctx.fill();
  ctx.restore();
};

export default shoal;
