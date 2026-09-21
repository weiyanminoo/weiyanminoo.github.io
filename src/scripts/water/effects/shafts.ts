// Slow god-rays from above. Rendered small and upscaled, exactly like the
// caustics: drawn at full size the quads are hard-edged polygons that read
// as sharp wedges rather than light. The upscale feathers their edges for
// free.
//
// Phase 7 fix round 3: the beams read as hard-edged uniform diagonal bands
// rather than god-rays. Rebuilt against the mockup's own `shafts()`
// (mockups/dive-log.html) — same technique and the same 180x110 buffer, so
// this is geometry and falloff, not strength (INTENSITY.shafts is
// unchanged). Four concrete differences, all fixed below: the three-stop
// gradient (a surface flare that attenuates, not a full-height ramp), the
// per-beam widths (five identical beams read as a repeating pattern), the
// FIXED lean (our bottom sway was animated independently of the top, so
// every beam's ANGLE changed over time — real god-rays track a fixed sun
// and only shimmer laterally), and the edge overdraw (beams used to
// terminate hard at the viewport sides and top).

import { clamp } from '../depth';
import type { Effect } from './types';
import { INTENSITY } from './intensity';

const BUFFER_WIDTH = 180;
const BUFFER_HEIGHT = 110;
const SHAFT_COUNT = 5;

// Shafts persist slightly deeper than caustics before fading out entirely.
const GATE_END_METRES = 14;

// Beam geometry, all as fractions of BUFFER_WIDTH so the shape is
// resolution-independent (the buffer is upscaled to the viewport). Mockup's
// own numbers.
const SWAY_AMPLITUDE = BUFFER_WIDTH * 0.055;
const SWAY_SPEED = 0.13;
const SWAY_PHASE_STEP = 1.7;
const START_OFFSET = BUFFER_WIDTH * 0.05;
const TOP_WIDTH_BASE = BUFFER_WIDTH * 0.026;
const TOP_WIDTH_STEP = BUFFER_WIDTH * 0.007;
const BOTTOM_WIDTH_BASE = BUFFER_WIDTH * 0.1;
const BOTTOM_WIDTH_STEP = BUFFER_WIDTH * 0.018;
// Constant, not a function of time: this is the sun's direction, and it
// does not move. The sway above shifts the WHOLE beam sideways, so the
// angle is the same every frame.
const LEAN = BUFFER_WIDTH * 0.085;
// Above the buffer's own top edge, so the beams have no hard top cut once
// the buffer is upscaled.
const QUAD_TOP_Y = -2;

// Three stops, not two. The middle one is what makes a shaft read as a
// surface flare that falls off fast rather than a solid band running the
// full height of the viewport: the mockup's own .24 -> .08 -> 0 at 0/.55/1,
// expressed here as fractions of INTENSITY.shafts so that constant stays
// the single peak-alpha dial.
const MID_STOP_POSITION = 0.55;
const MID_STOP_FRACTION = 0.08 / 0.24;

// Destination overdraw: the buffer is painted slightly wider and taller
// than the viewport so beam edges run off-screen instead of ending at it.
const OVERDRAW_X_PX = 24;
const OVERDRAW_Y_SCALE = 1.02;

let buffer: HTMLCanvasElement | null = null;
let bufferCtx: CanvasRenderingContext2D | null = null;

function ensureBuffer(): boolean {
  if (buffer && bufferCtx) {
    return true;
  }
  buffer = document.createElement('canvas');
  buffer.width = BUFFER_WIDTH;
  buffer.height = BUFFER_HEIGHT;
  bufferCtx = buffer.getContext('2d');
  return !!bufferCtx;
}

const shafts: Effect = (frame) => {
  if (!ensureBuffer() || !bufferCtx || !buffer) {
    return;
  }

  const gate = clamp(1 - frame.depthTop / GATE_END_METRES, 0, 1);
  if (gate <= 0) {
    return;
  }

  bufferCtx.clearRect(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);

  const peak = INTENSITY.shafts * gate;
  const gradient = bufferCtx.createLinearGradient(0, 0, 0, BUFFER_HEIGHT);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${peak})`);
  gradient.addColorStop(MID_STOP_POSITION, `rgba(255, 255, 255, ${peak * MID_STOP_FRACTION})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  bufferCtx.fillStyle = gradient;

  for (let i = 0; i < SHAFT_COUNT; i++) {
    const base =
      (i / SHAFT_COUNT) * BUFFER_WIDTH +
      Math.sin(frame.time * SWAY_SPEED + i * SWAY_PHASE_STEP) * SWAY_AMPLITUDE +
      START_OFFSET;
    const topWidth = TOP_WIDTH_BASE + i * TOP_WIDTH_STEP;
    const bottomWidth = BOTTOM_WIDTH_BASE + i * BOTTOM_WIDTH_STEP;

    bufferCtx.beginPath();
    bufferCtx.moveTo(base - topWidth / 2, QUAD_TOP_Y);
    bufferCtx.lineTo(base + topWidth / 2, QUAD_TOP_Y);
    bufferCtx.lineTo(base + bottomWidth / 2 + LEAN, BUFFER_HEIGHT);
    bufferCtx.lineTo(base - bottomWidth / 2 + LEAN, BUFFER_HEIGHT);
    bufferCtx.closePath();
    bufferCtx.fill();
  }

  const { ctx, width, height } = frame;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    buffer,
    0,
    0,
    BUFFER_WIDTH,
    BUFFER_HEIGHT,
    -OVERDRAW_X_PX,
    0,
    width + OVERDRAW_X_PX * 2,
    height * OVERDRAW_Y_SCALE
  );
  ctx.restore();
};

export default shafts;
