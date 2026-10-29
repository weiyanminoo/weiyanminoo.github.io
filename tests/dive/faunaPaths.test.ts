import { describe, it, expect } from 'vitest';
import {
  projectedHeightFraction,
  mantaPath,
  sharkPath,
  turtlePath,
  MANTA_SPAN_M,
  SHARK_LENGTH_M,
  TURTLE_LENGTH_M,
} from '../../src/scripts/dive/faunaPaths';
import { CAMERA_FOV_Y_DEG, diveStateAt } from '../../src/scripts/dive/timeline';
import { EDGE_X, REEF_TOP_DEPTH_M } from '../../src/scripts/dive/world';
import type { Vec3 } from '../../src/scripts/dive/types';

// Each animal's pass s runs over its shot (timeline.ts events).
const turtleP = (s: number) => 0.14 + 0.14 * s;
const mantaP = (s: number) => 0.58 + 0.08 * s;
const sharkP = (s: number) => 0.66 + 0.06 * s;

const from = (p: number, at: Vec3) => {
  const cam = diveStateAt(p).position;
  return [at[0] - cam[0], at[1] - cam[1], at[2] - cam[2]] as const;
};

/** Degrees between where the camera looks at p and the point `at`. */
function offAxis(p: number, at: Vec3): number {
  const { pitch, yaw } = diveStateAt(p).camera;
  const look = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const v = from(p, at);
  const len = Math.hypot(...v);
  const dot = (look[0] * v[0] + look[1] * v[1] + look[2] * v[2]) / len;
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

describe('projectedHeightFraction', () => {
  it('projects a 1 m object at 1 m through a 90° lens to half the frame', () => {
    expect(projectedHeightFraction(1, 1, 90)).toBeCloseTo(0.5);
  });
});

describe('turtlePath', () => {
  it('is near enough to read, never a close-up', () => {
    for (let s = 0; s <= 1; s += 0.01) {
      const d = Math.hypot(...from(turtleP(s), turtlePath(s).position));
      const share = projectedHeightFraction(TURTLE_LENGTH_M, d, CAMERA_FOV_Y_DEG);
      expect(share).toBeGreaterThan(0.06);
      expect(share).toBeLessThanOrEqual(0.25);
    }
  });

  it('crosses the view below the camera, well above the reef top', () => {
    for (let s = 0; s <= 1; s += 0.05) {
      const at = turtlePath(s).position;
      expect(from(turtleP(s), at)[1]).toBeLessThan(-2);
      // Clear of the tallest mound on the reef top.
      expect(-at[1] - 3).toBeLessThan(REEF_TOP_DEPTH_M - 3);
    }
    // Right to left across the look.
    expect(turtlePath(0.1).position[0]).toBeGreaterThan(turtlePath(0.9).position[0] + 6);
  });

  it('holds the frame through the middle of its pass', () => {
    for (const s of [0.2, 0.3, 0.4, 0.5]) expect(offAxis(turtleP(s), turtlePath(s).position)).toBeLessThan(22);
  });

  // Out past a 16:10 lens's 43° half-width — so past a phone's too —
  // before its pass ends, so the cut is never seen.
  it('swims out of the left of the frame before it is gone', () => {
    expect(offAxis(turtleP(0.95), turtlePath(0.95).position)).toBeGreaterThan(46);
  });
});

describe('mantaPath', () => {
  // Global constraint: never taller than a third of the frame.
  it('never fills more than a third of the frame', () => {
    for (let s = 0; s <= 1; s += 0.01) {
      const d = Math.hypot(...from(mantaP(s), mantaPath(s).position));
      expect(projectedHeightFraction(MANTA_SPAN_M, d, CAMERA_FOV_Y_DEG)).toBeLessThanOrEqual(1 / 3);
    }
  });

  it('glides above the camera, clear of the reef', () => {
    for (let s = 0; s <= 1; s += 0.05) {
      const at = mantaPath(s).position;
      expect(from(mantaP(s), at)[1]).toBeGreaterThan(4);
      // Out in the blue, or well above the crest where it comes in over it.
      expect(at[0] > EDGE_X + 8 || -at[1] - 3 < REEF_TOP_DEPTH_M - 2).toBe(true);
    }
  });

  // The camera follows it: near the middle of the frame for the whole
  // centre of its pass, so it shows even in a phone's narrow portrait view.
  it('is followed by the camera as it passes overhead', () => {
    for (const s of [0.35, 0.5, 0.65]) expect(offAxis(mantaP(s), mantaPath(s).position)).toBeLessThan(12);
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
      const d = Math.hypot(...from(sharkP(s), sharkPath(s).position));
      expect(projectedHeightFraction(SHARK_LENGTH_M, d, CAMERA_FOV_Y_DEG)).toBeLessThanOrEqual(1 / 6);
    }
  });

  it('cruises in the blue, well off the wall', () => {
    for (let s = 0; s <= 1; s += 0.05) expect(sharkPath(s).position[0]).toBeGreaterThan(EDGE_X + 12);
  });

  it('is near the middle of the frame when the camera turns out to it', () => {
    expect(offAxis(sharkP(0.5), sharkPath(0.5).position)).toBeLessThan(12);
  });

  // In frame when it arrives (from the haze, not from the edge), and out
  // of the right of the frame — past a 16:10 lens's 43° half-width, so
  // past a phone's too — before its pass ends, so the cut is never seen.
  it('comes in from the haze and swims out of frame before it is gone', () => {
    expect(offAxis(sharkP(0.1), sharkPath(0.1).position)).toBeLessThan(35);
    expect(offAxis(sharkP(0.95), sharkPath(0.95).position)).toBeGreaterThan(48);
  });
});
