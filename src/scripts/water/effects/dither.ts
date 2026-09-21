// 8-bit colour bands across a large smooth gradient. A tiled noise pattern,
// built once and composited with 'overlay' at low alpha, breaks the bands up
// without shifting the perceived colour: flat mid-grey is a no-op under
// overlay, so only the tiny per-pixel variation lands. Not depth-gated — it
// applies everywhere, at every depth.

import type { Effect } from './types';

const PATTERN_SIZE = 128;
const MID_GREY = 128;
const SPREAD = 12; // +/- range around mid-grey
const ALPHA = 0.05;

let pattern: CanvasPattern | null = null;

function buildPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = PATTERN_SIZE;
  tile.height = PATTERN_SIZE;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) {
    return null;
  }

  const imageData = tileCtx.createImageData(PATTERN_SIZE, PATTERN_SIZE);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = MID_GREY + (Math.random() - 0.5) * SPREAD;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  tileCtx.putImageData(imageData, 0, 0);

  return ctx.createPattern(tile, 'repeat');
}

const dither: Effect = (frame) => {
  const { ctx, width, height } = frame;

  if (!pattern) {
    pattern = buildPattern(ctx);
    if (!pattern) {
      return;
    }
  }

  ctx.save();
  ctx.globalAlpha = ALPHA;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

export default dither;
