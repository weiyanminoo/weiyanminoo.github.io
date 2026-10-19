// The storyboard (spec §6) as data, and the pure function that reads it:
// progress → DiveState. Scroll position is the director's timeline; nothing
// here knows about the DOM, Three.js or the clock.

import { clamp, lerp } from './math';
import type { CameraPose, DiveEvents, DiveState, SectionId, ShotId } from './types';

export const SHOTS: readonly { id: ShotId; from: number; to: number }[] = [
  { id: 'surface', from: 0, to: 0.06 },
  { id: 'descent', from: 0.06, to: 0.24 },
  { id: 'school', from: 0.24, to: 0.32 },
  { id: 'wall', from: 0.32, to: 0.36 },
  { id: 'insert-wall', from: 0.36, to: 0.46 },
  { id: 'insert-slope', from: 0.46, to: 0.52 },
  { id: 'reef-top', from: 0.52, to: 0.58 },
  { id: 'manta', from: 0.58, to: 0.66 },
  { id: 'shark', from: 0.66, to: 0.72 },
  { id: 'thermocline', from: 0.72, to: 0.76 },
  { id: 'dropoff', from: 0.76, to: 0.88 },
  { id: 'deep', from: 0.88, to: 1 },
];

/** [progress, metres], piecewise linear. */
export const DEPTH_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.06, 0],
  [0.24, 15],
  [0.32, 18],
  [0.46, 18],
  [0.58, 20],
  [0.72, 26],
  [0.76, 28],
  [0.88, 35],
  [1, 40],
];

/** [progress, pitch, yaw] in radians, smoothstep between neighbours.
 *  Starting values — tuned in the critique rounds. */
export const CAMERA_KEYS: readonly (readonly [number, number, number])[] = [
  // Up at the surface, but only ~26°: Snell's window and the sun glare sit
  // in the top quarter of the frame, behind the menu's gradient, and the
  // title reads over blue water below them.
  [0, 0.45, 0],
  [0.06, 0.45, 0],
  [0.2, -0.35, 0],
  [0.28, -0.1, 0.15],
  [0.34, -0.25, 0],
  // Out of the slope clip still looking down at the reef, as its camera
  // was: the cut carries the angle, and the floor fills the frame.
  [0.52, -0.42, 0],
  [0.6, 1.0, 0],
  // Down from the manta in good time to be level, turned left, for the
  // whole of the shark's pass (round 2: it crossed while the camera still
  // looked up).
  [0.64, 1.0, 0],
  [0.685, 0, 0.4],
  [0.74, 0, 0],
  [0.8, -0.45, 0],
  [0.92, -0.2, 0],
  [1, 0.6, 0],
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

function eventsAt(p: number): DiveEvents {
  return {
    exhaleBurst: triangle(p, 0.36, 0.012),
    snapperCross: triangle(p, 0.52, 0.015),
    manta: ramp(p, 0.58, 0.66),
    shark: ramp(p, 0.66, 0.72),
    thermocline: ramp(p, 0.72, 0.76),
  };
}

export function diveStateAt(progress: number): DiveState {
  const p = clamp(progress, 0, 1);
  const shot = SHOTS[shotIndexAt(p)];
  const shotT = (p - shot.from) / (shot.to - shot.from);
  const insert =
    shot.id === 'insert-wall'
      ? { clip: 'wall' as const, pushIn: shotT }
      : shot.id === 'insert-slope'
        ? { clip: 'slope' as const, pushIn: shotT }
        : null;
  return {
    progress: p,
    depth: linearAt(DEPTH_KEYS, p),
    shot: shot.id,
    shotT,
    camera: cameraAt(p),
    insert,
    events: eventsAt(p),
  };
}
