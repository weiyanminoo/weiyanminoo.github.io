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
import { wallPose } from './reefPaths';
import type { Vec3 } from './types';

export interface SchoolSpec {
  id: 'open-blue' | 'snapper' | 'jacks' | 'anthias';
  count: number;
  /** Half-extent of the school around its centre, metres. */
  radius: Vec3;
  seed: number;
  /** Camera-relative centre at (time, scroll pass s). */
  centre(timeS: number, s: number): Vec3;
  /** Swim direction bias, m/s. Where scroll (not time) carries the school,
   *  this keeps the fish facing the way they travel on screen. */
  swim: Vec3;
  /** A milling school: fish hold places in a hollow column and circle its
   *  vertical axis at about this rate, rad/s, counter-clockwise from above. */
  orbit?: number;
  /** How far a fish wanders from its place, as a share of the radius. */
  wander?: number;
  /** Radians the school's own frame is swung about the vertical at pass s,
   *  for a school laid out along something that turns (the wall). */
  turn?(s: number): number;
}

// Where a school with nowhere to be is put (the layer parks it anyway).
const NOWHERE: Vec3 = [0, 0, -1000];

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
    // Yellow snapper streaming across the lens over the reef top: right to
    // left at eye level, the whole school just in front of the camera at
    // s = 0.5 (ref 2, 2:05), turning off before the wall on the left.
    id: 'snapper',
    count: 150,
    radius: [3, 1.0, 1.4],
    seed: 808,
    centre: (t, s) => [lerp(10, -8, s) + 0.6 * Math.sin(0.4 * t), -0.4 + 0.3 * Math.sin(0.5 * t), -1.6],
    swim: [-1.5, 0, 0],
  },
  {
    // Jacks milling in a slow column above and ahead in the deep: dark
    // shapes against the last of the light, where the final shot looks up
    // (round 3 critique: the deep was twelve per cent of empty blue).
    id: 'jacks',
    count: 300,
    radius: [7, 5, 7],
    seed: 909,
    centre: (t, s) => [lerp(4, -2, s) + 0.8 * Math.sin(0.07 * t), 6 + 0.6 * Math.sin(0.11 * t), -12],
    swim: [0, 0, 0],
    orbit: 0.18,
    wander: 0.05,
  },
  {
    // Anthias: a cloud of small orange reef fish hovering just off the
    // wall face, as on every wall in the tropics. Laid out in the wall's
    // own frame (x along the face, z out from it) and swung round with it,
    // anchored to the rock, so the camera swims past them along the wall.
    // s is raw progress (the wall's pose is a function of it).
    id: 'anthias',
    count: 420,
    radius: [8, 3.5, 1.8],
    seed: 1010,
    centre: (t, s) => {
      const w = wallPose(s);
      if (!w) return NOWHERE;
      // 9 m along from the camera when the turn ends (slide 20), passing
      // it as the slide runs down, 2.5 m off the face.
      const along = 9 + (w.slide - 20) + 1.5 * Math.sin(0.05 * t);
      const out = -w.distance + 2.5;
      const c = Math.cos(w.turn);
      const sn = Math.sin(w.turn);
      return [along * c + out * sn, -1 + 0.8 * Math.sin(0.07 * t), -along * sn + out * c];
    },
    swim: [0, 0, 0],
    wander: 0.2,
    turn: (s) => wallPose(s)?.turn ?? 0,
  },
];

const WANDER = 0.15;
const WANDER_RATE = 0.3;
const HEADING_DT = 0.05;

/** A fish's seeded place in its school, in units of the school radius. */
function place(spec: SchoolSpec, i: number, t: number): number[] {
  if (spec.orbit !== undefined) {
    // A hollow column, every fish circling its axis at its own pace.
    const rho = 0.55 + 0.45 * hash1(i, spec.seed);
    const a = hash1(i, spec.seed + 1) * Math.PI * 2 + spec.orbit * (0.85 + 0.3 * hash1(i, spec.seed + 2)) * t;
    return [rho * Math.cos(a), hash1(i, spec.seed + 3) * 2 - 1, rho * Math.sin(a)];
  }
  // A seeded point inside the unit ball.
  const dx = hash1(i, spec.seed) * 2 - 1;
  const dy = hash1(i, spec.seed + 1) * 2 - 1;
  const dz = hash1(i, spec.seed + 2) * 2 - 1;
  const len = Math.hypot(dx, dy, dz) || 1;
  const r = Math.cbrt(hash1(i, spec.seed + 3));
  return [(dx / len) * r, (dy / len) * r, (dz / len) * r];
}

function position(spec: SchoolSpec, i: number, t: number, s: number): Vec3 {
  const c = spec.centre(t, s);
  const u = place(spec, i, t);
  const wander = spec.wander ?? WANDER;
  const o = [0, 1, 2].map(
    (k) => spec.radius[k] * (u[k] + wander * noise1(t * WANDER_RATE + i * (1.31 + k), spec.seed + 4 + k)),
  );
  if (spec.turn) {
    const a = spec.turn(s);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    [o[0], o[2]] = [o[0] * cos + o[2] * sin, -o[0] * sin + o[2] * cos];
  }
  return [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
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
