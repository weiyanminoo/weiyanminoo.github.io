// Where the two big animals swim, in the dive site's coordinates
// (world.ts), as a function of their scroll-driven pass s (events.manta /
// events.shark, 0 → 1). Both stay at the reference's own distances (spec
// §4): the manta overhead in silhouette against the light, the shark out
// in the haze. Neither is ever allowed close enough to become a close-up.

import { lerp } from './math';
import { MANTA_PASS, SHARK_PASS, positionAt } from './timeline';
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

// Both swim with the current the camera drifts in, as pelagics along a
// wall do, so each is placed relative to where the drifting camera is at
// that moment of its pass, out in the blue; parallax against the reef is
// still real, because the reef is fixed and they are not. The camera turns
// its head to follow each (timeline.ts CAMERA_KEYS).
const passP = (pass: readonly [number, number], s: number) => pass[0] + (pass[1] - pass[0]) * s;

// Gliding across the view ahead and ~9 m above, from the blue in towards
// the reef — mantas visit the cleaning stations along a wall's crest —
// showing its belly against the light. About 14 m away at its nearest.
const manta = (s: number): Vec3 => {
  const cam = positionAt(passP(MANTA_PASS, s));
  return [cam[0] + lerp(17, -9, s), cam[1] + 8 + Math.sin(Math.PI * s), cam[2] - 11];
};

// Closing slowly out of the haze on the right at the camera's depth: about
// 15 m away at its nearest — a small shape in the blue, as in reference 2
// at 3:20, but a readable one (round 2: at 15 m and dark it was a speck).
const shark = (s: number): Vec3 => {
  const cam = positionAt(passP(SHARK_PASS, s));
  return [cam[0] + 14, cam[1] + lerp(-1, 0, s), cam[2] + lerp(-22, -6, s)];
};

export function mantaPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(manta, s);
}

export function sharkPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(shark, s);
}
