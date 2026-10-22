// The storyboard (spec §6) as data, and the pure function that reads it:
// progress → DiveState. Scroll position is the director's timeline; nothing
// here knows about the DOM, Three.js or the clock.
//
// One dive, told in order through one fixed reef (world.ts): the descent
// half of a real wall dive. Back-roll beside the reef, free descent in the
// blue with the reef rising out of the haze below, settle over the reef top
// and fin along it, go over the edge looking down the face, then drift down
// the wall with it on the left and the blue on the right — where the manta
// and the shark pass — to 40 m, and look up.

import { clamp, lerp } from './math';
import type { CameraPose, DiveEvents, DiveState, SectionId, ShotId, Vec3 } from './types';
import { GROWTH_REACH_M, faceReach } from './reefShape';
import { worldY } from './world';

export const SHOTS: readonly { id: ShotId; from: number; to: number }[] = [
  { id: 'surface', from: 0, to: 0.06 },
  { id: 'descent', from: 0.06, to: 0.24 },
  { id: 'school', from: 0.24, to: 0.32 },
  { id: 'reef-top', from: 0.32, to: 0.46 },
  { id: 'dropoff', from: 0.46, to: 0.54 },
  { id: 'wall', from: 0.54, to: 0.58 },
  { id: 'manta', from: 0.58, to: 0.66 },
  { id: 'shark', from: 0.66, to: 0.72 },
  { id: 'thermocline', from: 0.72, to: 0.76 },
  { id: 'deep-wall', from: 0.76, to: 0.88 },
  { id: 'deep', from: 0.88, to: 1 },
];

/** [progress, metres], piecewise linear. Level over the reef top, hovering
 *  ~5 m above it (it is 19.5 m deep); the drop down the face begins only
 *  once the camera is out over the edge. */
export const DEPTH_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.06, 0],
  [0.24, 13],
  [0.32, 14.5],
  [0.46, 14.5],
  [0.49, 14.8],
  [0.54, 20],
  [0.66, 24],
  [0.72, 26],
  [0.76, 28],
  [0.88, 35],
  [1, 40],
];

/** [progress, x, z]: where the camera swims, in world metres (world.ts),
 *  interpolated smoothly (monotone cubic), so it never stops dead, never
 *  turns on a point and never swims back. About 200 m of swimming per unit
 *  of progress once on the reef: a steady fin pace. */
export const CAMERA_PATH: readonly (readonly [number, number, number])[] = [
  // In the blue 10 m off the crest, under the boat.
  [0, 10, 0],
  [0.06, 10, -1],
  // Free descent, drifting in towards the reef as it rises out of the haze.
  [0.15, 8, -9],
  [0.24, 4, -21],
  // Over the crest and onto the reef top, well in from the edge: the top's
  // own coral and bommies under the lens, the rim and the blue off to the
  // right (along the crest line itself the rim was the whole foreground,
  // round 8).
  [0.32, -9, -37],
  [0.46, -8, -63],
  // Out over the edge…
  [0.5, 2, -71],
  [0.54, 8.5, -77],
  // …and down the face, ~11 m off its line (its spurs and fans come within
  // a few metres).
  [0.66, 11, -103],
  [0.76, 11, -125],
  [0.88, 11, -151],
  // Levelling off at 40 m, easing away from the face into the blue.
  [1, 14, -163],
];

/** [progress, pitch, yaw] in radians, smoothstep between neighbours. Yaw is
 *  relative to the swim (−z); positive looks left, towards the wall. */
export const CAMERA_KEYS: readonly (readonly [number, number, number])[] = [
  // Up at the surface, but only ~26°: Snell's window and the sun glare sit
  // in the top quarter of the frame, behind the menu's gradient, and the
  // title reads over blue water below them.
  [0, 0.45, 0],
  [0.06, 0.45, 0],
  // Looking down and left at the reef rising out of the blue.
  [0.15, -0.35, 0.25],
  [0.24, -0.4, 0.15],
  // Level for the fusiliers over the crest.
  [0.3, -0.2, 0],
  // Over the reef top, glancing right towards the edge.
  [0.38, -0.3, -0.1],
  [0.44, -0.3, 0.05],
  // Over the edge: looking down the face as it drops away on the left.
  [0.5, -0.7, 0.45],
  // Drifting along it, the face in the left third.
  [0.55, -0.3, 0.3],
  // Up and out into the blue, following the manta as it glides across
  // above, from the blue in towards the reef (faunaPaths.ts).
  [0.595, 0.45, -0.7],
  [0.62, 0.62, -0.28],
  [0.65, 0.53, 0.4],
  // Level and out to the right, into the haze, as the shark closes.
  [0.69, -0.03, -0.8],
  [0.72, 0, -1.15],
  // Back to the wall for the thermocline.
  [0.76, 0, 0],
  // Down the deep face.
  [0.8, -0.45, 0.35],
  [0.92, -0.2, -0.3],
  // At 40 m, looking up at the last of the light.
  [1, 0.6, -0.2],
];

/** Where each section's centre sits in the dive. The page's scroll mapping
 *  pins each station's on-screen centre to these values. */
export const SECTION_PROGRESS: Readonly<Record<SectionId, number>> = {
  title: 0,
  about: 0.15,
  work: 0.41,
  school: 0.52,
  projects: 0.65,
  hobbies: 0.82,
  contact: 0.94,
};

/** Vertical field of view: about 20.8 mm full-frame equivalent, inside the
 *  spec's 20–24 mm wide lens. */
export const CAMERA_FOV_Y_DEG = 60;

function linearAt(keys: readonly (readonly [number, number])[], p: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    const [p0, v0] = keys[i];
    const [p1, v1] = keys[i + 1];
    if (p <= p1) return lerp(v0, v1, (p - p0) / (p1 - p0));
  }
  return keys[keys.length - 1][1];
}

/** Monotone cubic (Fritsch–Butland) through keys[i][0] → keys[i][channel]:
 *  smooth velocity, and no overshoot past any key, so a path that only ever
 *  heads south never swings north between keys. */
function monotoneAt(keys: readonly (readonly number[])[], channel: number, p: number): number {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && p > keys[i + 1][0]) i++;
  const secant = (k: number) => (keys[k + 1][channel] - keys[k][channel]) / (keys[k + 1][0] - keys[k][0]);
  const tangent = (k: number) => {
    if (k === 0) return secant(0);
    if (k === n - 1) return secant(n - 2);
    const d0 = secant(k - 1);
    const d1 = secant(k);
    if (d0 * d1 <= 0) return 0;
    const h0 = keys[k][0] - keys[k - 1][0];
    const h1 = keys[k + 1][0] - keys[k][0];
    const w0 = 2 * h1 + h0;
    const w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  const [p0, p1] = [keys[i][0], keys[i + 1][0]];
  const h = p1 - p0;
  const t = clamp((p - p0) / h, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * keys[i][channel] +
    (t3 - 2 * t2 + t) * h * tangent(i) +
    (-2 * t3 + 3 * t2) * keys[i + 1][channel] +
    (t3 - t2) * h * tangent(i + 1)
  );
}

function cameraAt(p: number): CameraPose {
  for (let i = 0; i < CAMERA_KEYS.length - 1; i++) {
    const [p0, pitch0, yaw0] = CAMERA_KEYS[i];
    const [p1, pitch1, yaw1] = CAMERA_KEYS[i + 1];
    if (p <= p1) {
      const t = (p - p0) / (p1 - p0);
      const s = t * t * (3 - 2 * t);
      return { pitch: lerp(pitch0, pitch1, s), yaw: lerp(yaw0, yaw1, s) };
    }
  }
  const [, pitch, yaw] = CAMERA_KEYS[CAMERA_KEYS.length - 1];
  return { pitch, yaw };
}

// Down the wall, the camera keeps a set distance off the real rock
// (reefShape.ts), as a diver does: close enough that the wall's colour
// survives the water between, never in its fans. The face's reach near
// each point of the drift is sampled once, then held at its local maximum
// and smoothed, so the camera follows the wall's bays and spurs without
// wobbling.
const WALL_CLEARANCE_M = 1.4;
const FOLLOW_FROM = 0.5;
const FOLLOW_TO = 1;
const FOLLOW_STEP = 0.004;
const FOLLOW: readonly number[] = (() => {
  const n = Math.round((FOLLOW_TO - FOLLOW_FROM) / FOLLOW_STEP) + 1;
  const reach = Array.from({ length: n }, (_, i) => {
    const p = FOLLOW_FROM + i * FOLLOW_STEP;
    return faceReach(monotoneAt(CAMERA_PATH, 2, p), linearAt(DEPTH_KEYS, p));
  });
  const held = reach.map((_, i) => Math.max(...reach.slice(Math.max(0, i - 3), i + 4)));
  return held.map((_, i) => {
    const near = held.slice(Math.max(0, i - 4), i + 5);
    return near.reduce((a, b) => a + b, 0) / near.length + GROWTH_REACH_M + WALL_CLEARANCE_M;
  });
})();

function followX(p: number): number {
  const t = (clamp(p, FOLLOW_FROM, FOLLOW_TO) - FOLLOW_FROM) / FOLLOW_STEP;
  const i = Math.min(FOLLOW.length - 2, Math.floor(t));
  return lerp(FOLLOW[i], FOLLOW[i + 1], t - i);
}

/** The camera's place in the dive site at progress p, world metres. */
export function positionAt(progress: number): Vec3 {
  const p = clamp(progress, 0, 1);
  // Onto the face's line once over the edge; away from it into the blue at
  // the very end.
  const onWall = smoothstep01((p - 0.5) / 0.06) * (1 - smoothstep01((p - 0.9) / 0.08));
  const x = lerp(monotoneAt(CAMERA_PATH, 1, p), followX(p), onWall);
  return [x, worldY(linearAt(DEPTH_KEYS, p)), monotoneAt(CAMERA_PATH, 2, p)];
}

function smoothstep01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

function shotIndexAt(p: number): number {
  let lo = 0;
  let hi = SHOTS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SHOTS[mid].from <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 1 at the centre, falling to 0 at ±halfWidth. */
function triangle(p: number, centre: number, halfWidth: number): number {
  return Math.max(0, 1 - Math.abs(p - centre) / halfWidth);
}

/** 0 before the window, 1 after it. */
function ramp(p: number, from: number, to: number): number {
  return clamp((p - from) / (to - from), 0, 1);
}

/** [from, to] progress of each big animal's pass (events.manta, .shark). */
export const MANTA_PASS: readonly [number, number] = [0.58, 0.66];
export const SHARK_PASS: readonly [number, number] = [0.66, 0.72];

function eventsAt(p: number): DiveEvents {
  return {
    snapperCross: triangle(p, 0.42, 0.015),
    manta: ramp(p, ...MANTA_PASS),
    shark: ramp(p, ...SHARK_PASS),
    thermocline: ramp(p, 0.72, 0.76),
  };
}

export function diveStateAt(progress: number): DiveState {
  const p = clamp(progress, 0, 1);
  const shot = SHOTS[shotIndexAt(p)];
  const shotT = (p - shot.from) / (shot.to - shot.from);
  return {
    progress: p,
    depth: linearAt(DEPTH_KEYS, p),
    shot: shot.id,
    shotT,
    camera: cameraAt(p),
    position: positionAt(p),
    events: eventsAt(p),
  };
}
