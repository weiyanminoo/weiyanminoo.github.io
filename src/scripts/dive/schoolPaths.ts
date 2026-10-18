// Schools of fish as closed-form paths, not a flocking simulation: a
// school's centre follows a parametric path in (time, s), and each fish
// keeps a seeded place in it that wanders slowly. Any frame can be
// rendered on its own (spec §5).
//
// `s` is the scroll-driven pass: for the open-blue school it is the
// `school` shot's own progress; for the snapper it sweeps the school across
// the lens, centred on the cut back to the wide view at 0.52.

import { lerp } from './math';
import { hash1, noise1 } from './noise';
import type { Vec3 } from './types';

export interface SchoolSpec {
  id: 'open-blue' | 'snapper';
  count: number;
  /** Half-extent of the school around its centre, metres. */
  radius: Vec3;
  seed: number;
  /** Camera-relative centre at (time, scroll pass s). */
  centre(timeS: number, s: number): Vec3;
  /** Swim direction bias, m/s. Where scroll (not time) carries the school,
   *  this keeps the fish facing the way they travel on screen. */
  swim: Vec3;
}

export const SCHOOLS: readonly SchoolSpec[] = [
  {
    // Wheeling through the open blue between the camera and the wall
    // (ref 2, 1:35).
    id: 'open-blue',
    count: 400,
    radius: [7, 3, 4],
    seed: 707,
    centre: (t, s) => [
      5 * Math.cos(0.22 * t) + lerp(-6, 6, s),
      -1 + 1.2 * Math.sin(0.15 * t),
      -10 + 3 * Math.sin(0.22 * t),
    ],
    swim: [0, 0, 0],
  },
  {
    // Yellow snapper streaming across the lens: right to left at eye level,
    // the whole school just in front of the camera at s = 0.5 so it fills
    // the frame for the cut (ref 2, 2:05).
    id: 'snapper',
    count: 150,
    radius: [3, 1.0, 1.4],
    seed: 808,
    centre: (t, s) => [lerp(14, -14, s) + 0.6 * Math.sin(0.4 * t), -0.4 + 0.3 * Math.sin(0.5 * t), -1.6],
    swim: [-1.5, 0, 0],
  },
];

// How far a fish wanders from its place, as a share of the school radius.
const WANDER = 0.15;
const WANDER_RATE = 0.3;
const HEADING_DT = 0.05;

function position(spec: SchoolSpec, i: number, t: number, s: number): Vec3 {
  const c = spec.centre(t, s);
  // A seeded point inside the unit ball.
  const dx = hash1(i, spec.seed) * 2 - 1;
  const dy = hash1(i, spec.seed + 1) * 2 - 1;
  const dz = hash1(i, spec.seed + 2) * 2 - 1;
  const len = Math.hypot(dx, dy, dz) || 1;
  const r = Math.cbrt(hash1(i, spec.seed + 3));
  const u = [(dx / len) * r, (dy / len) * r, (dz / len) * r];
  return [0, 1, 2].map(
    (k) => c[k] + spec.radius[k] * (u[k] + WANDER * noise1(t * WANDER_RATE + i * (1.31 + k), spec.seed + 4 + k)),
  ) as unknown as Vec3;
}

export function fishPose(
  spec: SchoolSpec,
  index: number,
  timeS: number,
  s: number,
): { position: Vec3; heading: Vec3 } {
  const p = position(spec, index, timeS, s);
  const a = position(spec, index, timeS - HEADING_DT, s);
  const b = position(spec, index, timeS + HEADING_DT, s);
  const v = [0, 1, 2].map((k) => (b[k] - a[k]) / (2 * HEADING_DT) + spec.swim[k]);
  const len = Math.hypot(v[0], v[1], v[2]);
  const heading: Vec3 = len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, -1];
  return { position: p, heading };
}
