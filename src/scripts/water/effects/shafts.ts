// Slow god-rays from above. Rendered small and upscaled, exactly like the
// caustics: drawn at full size the quads are hard-edged polygons that read
// as sharp wedges rather than light. The upscale feathers their edges for
// free.

import { clamp } from '../depth';
import type { Effect } from './types';

const BUFFER_WIDTH = 180;
const BUFFER_HEIGHT = 110;
const SHAFT_COUNT = 5;
const PEAK_ALPHA = 0.5;

// Shafts persist slightly deeper than caustics before fading out entirely.
const GATE_END_METRES = 14;

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

  for (let i = 0; i < SHAFT_COUNT; i++) {
    const seed = (i + 0.5) / SHAFT_COUNT;
    const sway = Math.sin(frame.time * 0.15 + i * 1.7) * 10;
    const topX = seed * BUFFER_WIDTH + sway;
    const bottomX = topX + Math.sin(frame.time * 0.1 + i) * 20 + 14;
    const topWidth = 4;
    const bottomWidth = 26;

    const gradient = bufferCtx.createLinearGradient(0, 0, 0, BUFFER_HEIGHT);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${PEAK_ALPHA * gate})`);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    bufferCtx.fillStyle = gradient;
    bufferCtx.beginPath();
    bufferCtx.moveTo(topX - topWidth / 2, 0);
    bufferCtx.lineTo(topX + topWidth / 2, 0);
    bufferCtx.lineTo(bottomX + bottomWidth / 2, BUFFER_HEIGHT);
    bufferCtx.lineTo(bottomX - bottomWidth / 2, BUFFER_HEIGHT);
    bufferCtx.closePath();
    bufferCtx.fill();
  }

  const { ctx, width, height } = frame;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buffer, 0, 0, BUFFER_WIDTH, BUFFER_HEIGHT, 0, 0, width, height);
  ctx.restore();
};

export default shafts;
