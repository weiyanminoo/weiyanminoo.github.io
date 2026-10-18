import { describe, it, expect } from 'vitest';
import {
  projectedHeightFraction,
  mantaPath,
  sharkPath,
  MANTA_SPAN_M,
  SHARK_LENGTH_M,
} from '../../src/scripts/dive/faunaPaths';
import { CAMERA_FOV_Y_DEG } from '../../src/scripts/dive/timeline';

describe('projectedHeightFraction', () => {
  it('projects a 1 m object at 1 m through a 90° lens to half the frame', () => {
    expect(projectedHeightFraction(1, 1, 90)).toBeCloseTo(0.5);
  });
});

describe('mantaPath', () => {
  // Global constraint: never taller than a third of the frame.
  it('never fills more than a third of the frame', () => {
    for (let s = 0; s <= 1; s += 0.01) {
      const d = Math.hypot(...mantaPath(s).position);
      expect(projectedHeightFraction(MANTA_SPAN_M, d, CAMERA_FOV_Y_DEG)).toBeLessThanOrEqual(1 / 3);
    }
  });

  it('passes overhead', () => {
    expect(mantaPath(0.5).position[1]).toBeGreaterThan(4);
  });

  it('heads the way it moves', () => {
    const a = mantaPath(0.5).position;
    const b = mantaPath(0.51).position;
    const h = mantaPath(0.5).heading;
    const v = [0, 1, 2].map((k) => b[k] - a[k]);
    expect((v[0] * h[0] + v[1] * h[1] + v[2] * h[2]) / Math.hypot(...v)).toBeGreaterThan(0.95);
  });
});

describe('sharkPath', () => {
  it('stays far out in the haze', () => {
    for (let s = 0; s <= 1; s += 0.01) {
      const d = Math.hypot(...sharkPath(s).position);
      expect(projectedHeightFraction(SHARK_LENGTH_M, d, CAMERA_FOV_Y_DEG)).toBeLessThanOrEqual(1 / 6);
    }
  });
});
