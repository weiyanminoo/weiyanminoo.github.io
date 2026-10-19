// Where the two big animals swim, camera-relative, as a function of their
// scroll-driven pass s (events.manta / events.shark, 0 → 1). Both stay at
// the reference's own distances (spec §4): the manta overhead in
// silhouette against the light, the shark out in the haze. Neither is ever
// allowed close enough to become a close-up.

import { lerp } from './math';
import type { Vec3 } from './types';

export const MANTA_SPAN_M = 4;
export const SHARK_LENGTH_M = 2.2;

/** Share of the frame's height an object of `sizeM` fills at `distanceM`
 *  through a lens with vertical field of view `fovYDeg`. */
export function projectedHeightFraction(sizeM: number, distanceM: number, fovYDeg: number): number {
  return sizeM / (2 * distanceM * Math.tan((fovYDeg * Math.PI) / 360));
}

function along(path: (s: number) => Vec3, s: number): { position: Vec3; heading: Vec3 } {
  const position = path(s);
  const a = path(s - 0.005);
  const b = path(s + 0.005);
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return { position, heading: [v[0] / len, v[1] / len, v[2] / len] };
}

// Right to left almost straight overhead — the camera looks up ~57° in the
// manta shot — so its whole diamond shows, belly-on, against the light.
// Closest (≈12.3 m) at s = 0.5.
const manta = (s: number): Vec3 => [lerp(18, -18, s), 10 + Math.sin(Math.PI * s), -5 - s];

// A slow pass across the haze ahead and to the left, where the camera turns
// (yaw 0.4) in the shark shot: about 12.7 m away at its nearest — still a
// small shape in the blue, as in reference 2 at 3:20, but a readable one
// (round 2: at 15 m it was a speck).
const shark = (s: number): Vec3 => [lerp(8, -16, s), lerp(-1.5, -0.8, s), lerp(-15, -9, s)];

export function mantaPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(manta, s);
}

export function sharkPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(shark, s);
}
