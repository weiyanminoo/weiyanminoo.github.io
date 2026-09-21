// Rippling surface light. Composited with 'multiply', not 'screen': screen
// cannot brighten near-white surface water, so bright cells are painted as a
// near-white no-op and the ripple pattern lives in the shadows between them
// instead, as a pale blue that darkens. Rendered into a small offscreen
// buffer and upscaled — upscaling is what makes the ripples soft rather than
// hard-edged, and what makes this cheap.

import { clamp } from '../depth';
import type { Effect } from './types';

const BUFFER_WIDTH = 170;
const BUFFER_HEIGHT = 104;

// Metres at which the effect is strongest (0) and fully gone (12) — gone
// entirely by the time a page reaches Projects or Outside depth.
const GATE_END_METRES = 12;

// Trough depth out of 255, per channel: R darkens most, B least, for a pale
// blue shadow rather than a grey one.
const TROUGH_DEPTH: readonly [number, number, number] = [55, 25, 15];

let buffer: HTMLCanvasElement | null = null;
let bufferCtx: CanvasRenderingContext2D | null = null;
let imageData: ImageData | null = null;

function ensureBuffer(): boolean {
  if (buffer && bufferCtx && imageData) {
    return true;
  }
  buffer = document.createElement('canvas');
  buffer.width = BUFFER_WIDTH;
  buffer.height = BUFFER_HEIGHT;
  bufferCtx = buffer.getContext('2d');
  if (!bufferCtx) {
    return false;
  }
  imageData = bufferCtx.createImageData(BUFFER_WIDTH, BUFFER_HEIGHT);
  return true;
}

// Sum of sine terms over buffer coordinates and time; the positive part,
// cubed, gives sharp, small highlight cells surrounded by broad troughs.
function highlightAt(x: number, y: number, t: number): number {
  const s =
    Math.sin(x * 0.055 + t * 0.6) +
    Math.sin(y * 0.07 - t * 0.5) +
    Math.sin((x + y) * 0.035 + t * 0.8) +
    Math.sin((x - y) * 0.05 - t * 0.35);
  const positive = Math.max(0, s / 4);
  return positive * positive * positive;
}

const caustics: Effect = (frame) => {
  if (!ensureBuffer() || !bufferCtx || !imageData || !buffer) {
    return;
  }

  const gate = clamp(1 - frame.depthTop / GATE_END_METRES, 0, 1);
  if (gate <= 0) {
    return;
  }

  const data = imageData.data;
  for (let y = 0; y < BUFFER_HEIGHT; y++) {
    // Fades to zero at the bottom of the drawn region, so the layer never
    // ends in a hard horizontal cut.
    const falloff = 1 - y / (BUFFER_HEIGHT - 1);
    for (let x = 0; x < BUFFER_WIDTH; x++) {
      const highlight = highlightAt(x, y, frame.time);
      const strength = (1 - highlight) * falloff * gate;
      const i = (y * BUFFER_WIDTH + x) * 4;
      data[i] = 255 - strength * TROUGH_DEPTH[0];
      data[i + 1] = 255 - strength * TROUGH_DEPTH[1];
      data[i + 2] = 255 - strength * TROUGH_DEPTH[2];
      data[i + 3] = 255;
    }
  }
  bufferCtx.putImageData(imageData, 0, 0);

  const { ctx, width, height } = frame;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buffer, 0, 0, BUFFER_WIDTH, BUFFER_HEIGHT, 0, 0, width, height);
  ctx.restore();
};

export default caustics;
