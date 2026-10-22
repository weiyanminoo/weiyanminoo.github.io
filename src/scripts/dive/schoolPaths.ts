// Schools of fish as closed-form paths, not a flocking simulation: a
// school's centre follows a parametric path in (time, s), and each fish
// keeps a seeded place in it that wanders slowly. Any frame can be
// rendered on its own (spec §5).
//
// Every centre is in the dive site's own coordinates (world.ts): each
// school lives at a real place on the reef, set by where the camera will
// be when it gets there (timeline.ts positionAt), and the camera swims past
// it. `s` is the scroll-driven pass (schools.ts says how each maps progress
// to it).

import { lerp } from './math';
import { hash1, noise1 } from './noise';
import { positionAt } from './timeline';
import type { Vec3 } from './types';
import { worldY } from './world';
import { ANEMONES, PATH_BOMMIE, anemoneTop, bommieTop, faceX } from './reefShape';

export type SchoolId =
  | 'open-blue'
  | 'snapper'
  | 'jacks'
  | 'anthias'
  | 'chromis'
  | 'clownfish'
  | 'wrasse'
  | 'butterfly'
  | 'napoleon'
  | 'fusiliers'
  | 'barracuda'
  | 'deepRiver'
  | 'deepBand';

export interface SchoolSpec {
  id: SchoolId;
  count: number;
  /** Half-extent of the school around its centre, metres. */
  radius: Vec3;
  seed: number;
  /** World centre at (time, scroll pass s). */
  centre(timeS: number, s: number): Vec3;
  /** Swim direction bias, m/s. Where scroll (not time) carries the school,
   *  this keeps the fish facing the way they travel on screen. */
  swim: Vec3;
  /** A milling school: fish hold places in a hollow column and circle its
   *  vertical axis at about this rate, rad/s, counter-clockwise from above. */
  orbit?: number;
  /** How far a fish wanders from its place, as a share of the radius:
   *  one share for every axis, or one per axis. */
  wander?: number | Vec3;
  /** Metres of rise per metre north (+z): tilts a long school so it
   *  follows a slope, such as the dive's line down the wall. */
  shear?: number;
  /** Lays the school's x out from a surface instead of a plane: the
   *  surface's x at a fish's home (z, depth), added to its offset. */
  hug?(z: number, depthM: number): number;
}

// Where the camera is at each school's moment.
const OVER_CREST = positionAt(0.27);
const REEF_TOP = positionAt(0.42);
const DEEP = positionAt(0.95);

// The anthias' band down the face: from just past where the camera goes
// over the edge to the deep wall, following the camera's own descent.
const ANTHIAS_NORTH = positionAt(0.53);
const ANTHIAS_SOUTH = positionAt(0.8);
const ANTHIAS_Z = (ANTHIAS_NORTH[2] + ANTHIAS_SOUTH[2]) / 2;
const ANTHIAS_Y = (ANTHIAS_NORTH[1] + ANTHIAS_SOUTH[1]) / 2;
const ANTHIAS_HALF_LENGTH = (ANTHIAS_NORTH[2] - ANTHIAS_SOUTH[2]) / 2;
const ANTHIAS_SHEAR = (ANTHIAS_NORTH[1] - ANTHIAS_SOUTH[1]) / (ANTHIAS_NORTH[2] - ANTHIAS_SOUTH[2]);

// The chromis cloud's home: the crown of the bommie beside the dive's line.
const CHROMIS_HOME = bommieTop(PATH_BOMMIE);
const CLOWN_HOME = anemoneTop(ANEMONES[0]);
// Where the camera is along the wall, for the fish that pass it there, and
// in the deep.
const WALL_START = positionAt(0.6);
const WALL_MID = positionAt(0.78);
const DEEP_BAND = positionAt(0.84);
const DEEP_RIVER = positionAt(0.92);

export const SCHOOLS: readonly SchoolSpec[] = [
  {
    // Fusiliers wheeling in the blue just off the crest, as the camera
    // arrives over it (ref 2, 1:35).
    id: 'open-blue',
    count: 400,
    radius: [7, 3, 4],
    seed: 707,
    centre: (t, s) => [
      OVER_CREST[0] + 7 + 5 * Math.cos(0.22 * t) + lerp(-3, 3, s),
      OVER_CREST[1] + 1.5 + 1.2 * Math.sin(0.15 * t),
      OVER_CREST[2] - 6 + 3 * Math.sin(0.22 * t),
    ],
    swim: [0, 0, 0],
  },
  {
    // Yellow snapper streaming in off the edge and across the reef top
    // just ahead of the camera, at its height (ref 2, 2:05).
    id: 'snapper',
    count: 150,
    radius: [3, 1.0, 1.4],
    seed: 808,
    centre: (t, s) => [
      REEF_TOP[0] + lerp(10, -14, s) + 0.6 * Math.sin(0.4 * t),
      REEF_TOP[1] - 0.3 + 0.3 * Math.sin(0.5 * t),
      REEF_TOP[2] - 3,
    ],
    swim: [-1.5, 0, 0],
  },
  {
    // Jacks milling in a slow column in the blue above and ahead at 40 m:
    // pale flashes against the last of the light, where the final shot
    // looks up (round 3 critique: the deep was twelve per cent of empty
    // blue).
    id: 'jacks',
    count: 300,
    radius: [7, 5, 7],
    seed: 909,
    centre: (t) => [DEEP[0] + 6 + 0.8 * Math.sin(0.07 * t), DEEP[1] + 6 + 0.6 * Math.sin(0.11 * t), DEEP[2] - 12],
    swim: [0, 0, 0],
    orbit: 0.18,
    wander: 0.05,
  },
  {
    // Anthias: a long band of small orange reef fish hovering just off the
    // wall face all the way down the camera's line of descent, as on every
    // tropical wall. Fixed to the rock; the camera drifts past them.
    id: 'anthias',
    count: 700,
    radius: [1.6, 3.5, ANTHIAS_HALF_LENGTH],
    seed: 1010,
    centre: (t) => [2.4, ANTHIAS_Y + 0.6 * Math.sin(0.07 * t), ANTHIAS_Z],
    swim: [0, 0, 0],
    // Flitting in and out from the rock and up and down it, but staying on
    // their own stretch of it (the band is 50 m long).
    wander: [0.15, 0.12, 0.02],
    shear: ANTHIAS_SHEAR,
    // Just off the real rock, following its bays and spurs.
    hug: (z, depthM) => faceX(z, depthM),
  },
  {
    // Blue-green chromis hanging in a cloud over a bommie, as over every
    // big head on a reef top, and sinking into it as the camera comes
    // over.
    id: 'chromis',
    count: 360,
    radius: [2.2, 1.3, 2.2],
    seed: 1111,
    centre: (t, s) => [
      CHROMIS_HOME[0] + 0.3 * Math.sin(0.2 * t),
      CHROMIS_HOME[1] + 1.4 - 0.8 * s + 0.2 * Math.sin(0.3 * t),
      CHROMIS_HOME[2] + 0.3 * Math.cos(0.17 * t),
    ],
    swim: [0, 0, 0],
    wander: 0.3,
  },
  {
    // Three clownfish darting over their anemone beside the line.
    id: 'clownfish',
    count: 3,
    radius: [0.45, 0.3, 0.45],
    seed: 1212,
    centre: (t) => [CLOWN_HOME[0], CLOWN_HOME[1] + 0.5 + 0.08 * Math.sin(0.9 * t), CLOWN_HOME[2]],
    swim: [0, 0, 0],
    wander: 0.6,
  },
  {
    // Parrotfish circling the bommie, grazing its flanks.
    id: 'wrasse',
    count: 4,
    radius: [3.8, 0.6, 3.8],
    seed: 1313,
    centre: (t) => [CHROMIS_HOME[0], CHROMIS_HOME[1] + 0.6 + 0.3 * Math.sin(0.1 * t), CHROMIS_HOME[2]],
    swim: [0, 0, 0],
    orbit: 0.1,
    wander: 0.1,
  },
  {
    // A pair of butterflyfish working the bommie's east flank, under the
    // line.
    id: 'butterfly',
    count: 2,
    radius: [0.5, 0.3, 0.5],
    seed: 1414,
    centre: (t) => [
      CHROMIS_HOME[0] + 2.6 + 0.3 * Math.sin(0.3 * t),
      CHROMIS_HOME[1] - 0.6 + 0.15 * Math.sin(0.5 * t),
      CHROMIS_HOME[2] + 1.0 + 0.4 * Math.sin(0.21 * t),
    ],
    swim: [0, 0, 0],
    wander: 0.5,
  },
  {
    // A Napoleon wrasse cruising south down the wall a few metres off the
    // fans, ahead of and below the camera as it looks down the drop-off
    // (0.5–0.55), drawing slowly away.
    id: 'napoleon',
    count: 1,
    radius: [0.1, 0.1, 0.1],
    seed: 1515,
    centre: (t, s) => {
      const z = lerp(-80, -96, s);
      const depth = lerp(22, 26, s);
      return [faceX(z, depth) + 3.5, worldY(depth) + 0.3 * Math.sin(0.2 * t), z];
    },
    swim: [0.05, -0.15, -0.6],
    wander: 0,
  },
  {
    // Yellowback fusiliers streaming north up the wall, above and out from
    // the camera: against the light they are mostly silhouette.
    id: 'fusiliers',
    count: 350,
    radius: [4, 1.5, 7],
    seed: 1616,
    centre: (t, s) => [WALL_START[0] + 8 + 1.5 * Math.sin(0.15 * t), WALL_START[1] + 6 + 0.5 * Math.sin(0.1 * t), lerp(-112, -84, s)],
    swim: [0, 0, 1.5],
  },
  {
    // A wall of chevron barracuda hanging in the blue off the face,
    // turning slowly, dark against the light from the surface.
    id: 'barracuda',
    count: 140,
    radius: [6, 3, 6],
    seed: 1717,
    centre: (t) => [WALL_MID[0] + 17 + 0.5 * Math.sin(0.05 * t), WALL_MID[1] + 5, WALL_MID[2] + 4],
    swim: [0, 0, 0],
    orbit: 0.035,
    wander: 0.04,
  },
  {
    // A river of surgeonfish high overhead in the deep, silhouettes
    // crossing the last of the light as the final shot looks up.
    id: 'deepRiver',
    count: 300,
    radius: [5, 2, 14],
    seed: 1818,
    centre: (t, s) => [DEEP_RIVER[0] + 2 + Math.sin(0.1 * t), DEEP_RIVER[1] + 15, DEEP_RIVER[2] - 6 + lerp(18, -18, s)],
    swim: [0, 0, -1.5],
  },
  {
    // A long, loose band of trevally out in the blue at the edge of
    // sight, running the length of the deep wall: dark shapes streaming
    // north past the camera the whole way down.
    id: 'deepBand',
    count: 320,
    radius: [5, 3, 28],
    seed: 1919,
    centre: (t) => [DEEP_BAND[0] + 22 + 0.8 * Math.sin(0.06 * t), DEEP_BAND[1] + 2, -150],
    swim: [0, 0, 0.8],
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

// Each hugging fish's surface x at its home place, worked out once.
const hugCache = new Map<SchoolSpec, Float64Array>();

function hugAt(spec: SchoolSpec, i: number, s: number): number {
  let cache = hugCache.get(spec);
  if (!cache) {
    cache = new Float64Array(spec.count).fill(Number.NaN);
    hugCache.set(spec, cache);
  }
  if (Number.isNaN(cache[i])) {
    const c = spec.centre(0, s);
    const u = place(spec, i, 0);
    const z = c[2] + spec.radius[2] * u[2];
    const y = c[1] + spec.radius[1] * u[1] + (spec.shear ?? 0) * spec.radius[2] * u[2];
    cache[i] = spec.hug!(z, -y - 3);
  }
  return cache[i];
}

function position(spec: SchoolSpec, i: number, t: number, s: number): Vec3 {
  const c = spec.centre(t, s);
  const u = place(spec, i, t);
  const w = spec.wander ?? WANDER;
  const wander = typeof w === 'number' ? [w, w, w] : w;
  const o = [0, 1, 2].map(
    (k) => spec.radius[k] * (u[k] + wander[k] * noise1(t * WANDER_RATE + i * (1.31 + k), spec.seed + 4 + k)),
  );
  if (spec.shear) o[1] += spec.shear * o[2];
  if (spec.hug) o[0] += hugAt(spec, i, s);
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
