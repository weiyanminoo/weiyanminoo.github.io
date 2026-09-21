// Marine snow: tiny pale flecks drifting down below the thermocline,
// parallaxed to scroll. Closed-form in time — see effects/types.ts and the
// phase-5b brief's "every effect is closed-form" ruling: no per-frame
// integrated state, so the reduced-motion static frame at time=0 is a
// genuine composed frame, and a scroll/resize/astro:after-swap repaint
// outside the loop is correct at whatever `time` the loop last reached.
//
// Seeds are built once at module scope from the particle index alone
// (fract(i * golden ratio)), never Math.random() — deterministic across
// loads, which is what makes the reduced-motion frame and the contrast
// sweep reproducible.

import type { Effect } from './types';
import { INTENSITY } from './intensity';
import { ramp, depthAtY } from './gate';

const PARTICLE_COUNT = 70;
const LAYER_COUNT = 3;
const GOLDEN = 0.6180339887;
// A second, independent irrational multiplier for the wander phase (see
// below) — without it, phase is a fixed function of seedX and the whole
// field shears as one coherent travelling wave instead of wandering
// independently.
const GOLDEN_2 = 0.7548776662;

// far -> near: smaller, slower radius bands, and dimmer (LAYER_BRIGHTNESS
// below) — "smaller+slower+fainter -> larger+faster+brighter". Safe against
// the contrast bound regardless of the multiplier chosen, because it can
// only ever make a particle dimmer than snowAlphaAt(d) — the near layer's
// multiplier is exactly 1.0, so the peak tests/water/effects.test.ts sweeps
// is unchanged.
const RADIUS_RANGE: readonly (readonly [number, number])[] = [
  [0.6, 1.0],
  [1.0, 1.5],
  [1.5, 2.0],
];
const FALL_SPEED: readonly number[] = [0.01, 0.015, 0.022]; // viewport heights / second
const PARALLAX_FACTOR: readonly number[] = [0.5, 1.0, 1.5]; // nearer layers shift more per metre of depthTop
const LAYER_BRIGHTNESS: readonly number[] = [0.55, 0.78, 1.0];
const PARALLAX_PER_METRE = 0.015;

// Snow starts exactly at the top of the Outside band (24m) and reaches full
// strength at 31m — see tests/water/effects.test.ts for the stacked
// contrast bound this is solved against.
const GATE_FROM_METRES = 24;
const GATE_TO_METRES = 31;

// Below this, the fleck's own alpha rounds to zero at 8-bit precision —
// "draw nothing when the alpha rounds to zero" per the phase-5b brief. Just
// checking `alpha <= 0` is not the same test: for a wide gate range like
// this one, plenty of particles sit at 0 < alpha < 1/255 for a real span of
// depth just past 24m, where they'd still issue a (invisible but not free)
// draw call.
const MIN_VISIBLE_ALPHA = 1 / 255;

// One soft, fully-opaque-at-centre sprite, pre-rendered once at module
// scope and scaled per particle via drawImage's destination size — not
// three separately-built sprites, one per radius band. A radial gradient's
// shape doesn't change with the radius it's built at, only its scale does,
// and drawImage already scales continuously, so a second and third sprite
// would be pixel-identical modulo that scale — this gets the same "zero
// per-frame allocation, far cheaper than a gradient rasterisation per
// particle per frame" result with less code. Per-particle radius and
// per-layer brightness are still fully continuous/independent, applied at
// draw time via drawImage's size and ctx.globalAlpha.
const SPRITE_SIZE = 32;

// Built lazily on first draw, not eagerly at module load — same convention
// as dither.ts's buildPattern/caustics.ts's ensureBuffer, and required for
// the same reason: this module is imported by tests/water/effects.test.ts
// for snowAlphaAt, and that environment has no `document`.
let sprite: HTMLCanvasElement | null = null;

function ensureSprite(): HTMLCanvasElement | null {
  if (sprite) {
    return sprite;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const spriteCtx = canvas.getContext('2d');
  if (!spriteCtx) {
    return null;
  }
  const r = SPRITE_SIZE / 2;
  const gradient = spriteCtx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  spriteCtx.fillStyle = gradient;
  spriteCtx.beginPath();
  spriteCtx.arc(r, r, r, 0, Math.PI * 2);
  spriteCtx.fill();
  sprite = canvas;
  return sprite;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

/** JS `%` can return a negative result; this never does. */
function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

interface Particle {
  readonly seedX: number;
  readonly seedY: number;
  readonly radius: number;
  readonly fallSpeed: number;
  readonly parallaxFactor: number;
  readonly brightness: number;
  readonly phase: number;
}

// Built once at module scope, not per frame.
const PARTICLES: readonly Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
  const layer = i % LAYER_COUNT;
  const [minR, maxR] = RADIUS_RANGE[layer];
  return {
    seedX: fract(i * GOLDEN),
    seedY: fract(i * GOLDEN * 2 + 0.13),
    radius: minR + fract(i * GOLDEN + 0.37) * (maxR - minR),
    fallSpeed: FALL_SPEED[layer],
    parallaxFactor: PARALLAX_FACTOR[layer],
    brightness: LAYER_BRIGHTNESS[layer],
    phase: fract(i * GOLDEN_2 + 0.61) * Math.PI * 2,
  };
});

/** Peak alpha a snow particle at depth `d` may draw at — the number the
 *  contrast budget was solved against. Exported so the test exercises the
 *  exact expression the draw function uses, rather than a re-derived copy. */
export function snowAlphaAt(d: number): number {
  return INTENSITY.snow * ramp(d, GATE_FROM_METRES, GATE_TO_METRES);
}

const snow: Effect = (frame) => {
  const spriteImage = ensureSprite();
  if (!spriteImage) {
    return;
  }

  const { ctx, width, height, time, depthTop } = frame;

  ctx.save();
  for (const p of PARTICLES) {
    const parallax = depthTop * PARALLAX_PER_METRE * p.parallaxFactor;
    const y = wrap(p.seedY + time * p.fallSpeed + parallax, 1) * height;
    const x = wrap(p.seedX * width + Math.sin(time * 0.08 + p.phase) * 8, width);

    const alpha = snowAlphaAt(depthAtY(frame, y));
    if (alpha < MIN_VISIBLE_ALPHA) {
      continue;
    }

    ctx.globalAlpha = alpha * p.brightness;
    const d = p.radius * 2;
    ctx.drawImage(spriteImage, x - p.radius, y - p.radius, d, d);
  }
  ctx.restore();
};

export default snow;
