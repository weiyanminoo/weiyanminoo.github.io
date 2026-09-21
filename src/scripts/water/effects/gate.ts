// Pure depth-gating helpers shared by the three particle effects (snow,
// shoal, bubbles) — not a speculative abstraction, since all three need
// exactly this pair. No DOM, no canvas.

import type { WaterFrame } from './types';

/** 0 below `from`, 1 at/above `to`, linear between. Reversed when
 *  from > to (e.g. ramp(v, 19, 14) is a fade-DOWN as v rises from 14 to 19).
 *  Handles from === to without dividing by zero: 0 below `from`, 1 at/above
 *  it. */
export function ramp(value: number, from: number, to: number): number {
  if (from === to) {
    return value >= from ? 1 : 0;
  }
  const t = (value - from) / (to - from);
  return Math.min(1, Math.max(0, t));
}

/** Metres at viewport y, linear between the frame's top and bottom depths.
 *  Guards height === 0 rather than returning NaN — not a hypothetical: this
 *  preview harness has produced a real 0-height frame (see phase-5b-report.md). */
export function depthAtY(frame: WaterFrame, y: number): number {
  const { height, depthTop, depthBottom } = frame;
  if (height === 0) {
    return depthTop;
  }
  return depthTop + (depthBottom - depthTop) * (y / height);
}
