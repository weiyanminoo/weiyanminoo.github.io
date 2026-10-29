// Where the two big animals swim, in the dive site's coordinates
// (world.ts), as a function of their scroll-driven pass s (events.manta /
// events.shark, 0 → 1). Both stay at the reference's own distances (spec
// §4): the manta overhead in silhouette against the light, the shark out
// in the haze. Neither is ever allowed close enough to become a close-up.

import { lerp } from './math';
import { MANTA_PASS, SHARK_PASS, TURTLE_PASS, positionAt } from './timeline';
import type { Vec3 } from './types';

export const MANTA_SPAN_M = 4;
export const SHARK_LENGTH_M = 2.2;
/** A big green turtle: carapace well over a metre, flippers out past it. */
export const TURTLE_LENGTH_M = 1.3;

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

// Out of the haze ahead on the right at the camera's depth, cruising north
// the other way, about 14 m off: a small shape in the blue, as in
// reference 2 at 3:20, but a readable one (round 2: at 15 m and dark it
// was a speck). Abreast of the camera at mid-pass, where the camera has
// turned to follow it, then on past and out of the right of the frame
// before its pass ends — it used to vanish while still centred (round 9).
const shark = (s: number): Vec3 => {
  const cam = positionAt(passP(SHARK_PASS, s));
  return [cam[0] + 14, cam[1] + lerp(-1, 0, s), cam[2] + lerp(-26, -14, s) + 26 * s * s];
};

// A green turtle on the descent, where the camera looks down and left at
// the reef rising out of the haze (timeline.ts CAMERA_KEYS 0.15–0.24):
// crossing the view below from right to left, 8–9 m off, heading in over
// the reef top, so the shell is seen from above. Set against the look line
// itself (pitch −0.37, yaw 0.2 at mid-pass), so it holds the frame while
// the camera drifts; its drop below the camera closes as the camera sinks
// through the pass, so the turtle itself only eases down. It keeps going
// — out past the left of the frame and on into the haze — before its
// pass ends, so it is never cut off while in view (round 10).
const turtle = (s: number): Vec3 => {
  const cam = positionAt(passP(TURTLE_PASS, s));
  // 8.5 m along the look line, then across it, right to left and away.
  const across = lerp(4.2, -10.4, s);
  return [cam[0] - 1.6 + 0.98 * across, cam[1] - lerp(4.2, 2.4, s), cam[2] - 7.8 - 0.2 * across - 2.5 * s];
};

export function mantaPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(manta, s);
}

export function turtlePath(s: number): { position: Vec3; heading: Vec3 } {
  return along(turtle, s);
}

export function sharkPath(s: number): { position: Vec3; heading: Vec3 } {
  return along(shark, s);
}
