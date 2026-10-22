// The reef's shape, as pure functions of position: the wall face and the
// reef top, and the bommies standing on it. The reef layer builds its
// meshes from these, and the dive path and the fish read the same numbers
// to stay a set distance off the real rock. Nothing here imports Three.js.

import { lerp, smoothstep } from './math';
import { hash1 } from './noise';
import type { Vec3 } from './types';
import { EDGE_X, REEF_NORTH_Z, REEF_SOUTH_Z, REEF_TOP_DEPTH_M, WALL_BOTTOM_DEPTH_M, worldY } from './world';

export const REEF_SEED = 606;
export const REEF_LENGTH_M = REEF_NORTH_Z - REEF_SOUTH_Z;
export const REEF_MID_Z = (REEF_NORTH_Z + REEF_SOUTH_Z) / 2;
// The face's top rolls back over the crest into a rim standing a little
// proud of the reef top, which tucks in under it: one surface turns the
// corner, so there is no seam where two meet.
export const WALL_TOP_DEPTH_M = REEF_TOP_DEPTH_M - 1.5;
export const WALL_HEIGHT_M = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
/** How far out from the rock anything growing on it reaches: the widest
 *  sea fan turned edge-out (reef.ts places them). */
export const GROWTH_REACH_M = 3.3;

export function vnoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash1(i * 374761 + j * 668265, seed);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), u), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), u), v) * 2 - 1;
}

export function fbm2(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise2(x * f, y * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

/** How far east of EDGE_X the crest runs at world z: bays and promontories,
 *  shared by the face and the reef top so they always meet. */
export function meander(z: number): number {
  return 2.0 * fbm2(z * 0.025, 3.7, REEF_SEED + 55, 3) + 0.8 * Math.sin(z * 0.11 + 1.3);
}

/** The wall face's surface in its own frame (x along the wall, y up, z out
 *  of the rock; top = WALL_HEIGHT_M / 2), split into its broad shape and
 *  its local relief (which also drives the occlusion). The top rolls back
 *  west over the crest into the rim; the buttresses grow in below it, so
 *  the rim follows the crest line exactly and the reef top always tucks in
 *  under it. */
export function wallRelief(x: number, y: number, top: number): { broad: number; detail: number } {
  const lip = top - y;
  // Vertical buttresses and gullies, and big spurs tens of metres apart that
  // break the face's silhouette when seen along it.
  let broad =
    (1.8 * fbm2(x * 0.08, y * 0.08, REEF_SEED + 20) +
      0.8 * Math.sin(x * 0.21 + 2.0 * fbm2(x * 0.05, y * 0.03, REEF_SEED + 22)) +
      2.0 * fbm2(x * 0.025, y * 0.015, REEF_SEED + 26, 2)) *
    smoothstep(0, 6, lip);
  broad += meander(REEF_MID_Z - x);
  // Leaning back as it drops, so the face falls away beneath you rather
  // than standing as a vertical slab.
  broad -= 0.15 * Math.max(0, lip - 4);
  if (lip < 3) broad -= (3 - lip) ** 2 * 0.9;
  // Crevices: narrow grooves along the zero lines of a stretched noise
  // field (ridged noise), with the finer knobbly relief.
  const groove = (1 - Math.abs(fbm2(x * 0.16, y * 0.45, REEF_SEED + 24, 3))) ** 8;
  const detail =
    0.9 * fbm2(x * 0.35, y * 0.35, REEF_SEED + 21, 3) + 0.35 * fbm2(x * 1.1, y * 1.1, REEF_SEED + 23, 2) - 0.9 * groove;
  return { broad, detail };
}

export function wallZ(x: number, y: number, top: number): number {
  const { broad, detail } = wallRelief(x, y, top);
  return broad + detail;
}

/** World x of the rock face at world z and depth (metres). */
export function faceX(z: number, depthM: number): number {
  const top = WALL_HEIGHT_M / 2;
  return EDGE_X + wallZ(REEF_MID_Z - z, top - (depthM - WALL_TOP_DEPTH_M), top);
}

/** The furthest out the rock comes around (z, depth): ±window metres along
 *  the wall and ±depthWindow up and down it. */
export function faceReach(z: number, depthM: number, window = 8, depthWindow = 4): number {
  let reach = -Infinity;
  for (let dz = -window; dz <= window; dz += 2) {
    for (let dd = -depthWindow; dd <= depthWindow; dd += 2) {
      reach = Math.max(reach, faceX(z + dz, depthM + dd));
    }
  }
  return reach;
}

// The reef top is laid out in (u, z): u is metres east of the crest line
// (negative: west of it, on the reef top), so it follows the meander.

/** The reef top stops this far west of the crest line, under the rim. */
export const REEF_TOP_EAST_U = -4;

export const crestX = (u: number, z: number) => EDGE_X + u + meander(z);

/** Spur-and-groove: sand channels running out to the edge between coral
 *  spurs, as on the seaward side of real reef tops. 0 on a spur, 1 in a
 *  channel. */
export function channel(u: number, z: number): number {
  const wave = 0.5 + 0.5 * Math.sin(z * 0.28 + 1.6 * fbm2(u * 0.04, z * 0.04, REEF_SEED + 52, 3));
  return smoothstep(0.62, 0.92, wave) * smoothstep(-36, -8, u);
}

/** The reef top's height at (u, z), split into broad shape and local
 *  relief. It dips gently as it reaches the crest, to run in under the
 *  face's rim. */
export function reefTopRelief(u: number, z: number): { broad: number; detail: number } {
  let broad = worldY(REEF_TOP_DEPTH_M) + 1.2 * fbm2(u * 0.12, z * 0.12, REEF_SEED + 50) - 1.0 * channel(u, z);
  const under = u - (REEF_TOP_EAST_U - 2);
  if (under > 0) broad -= under * 0.4;
  return { broad, detail: 0.45 * fbm2(u * 0.6, z * 0.6, REEF_SEED + 51, 3) * (1 - 0.7 * channel(u, z)) };
}

export function reefTopY(u: number, z: number): number {
  const { broad, detail } = reefTopRelief(u, z);
  return broad + detail;
}

/** A bommie: one of the big coral heads that stand up from a reef top,
 *  the landmarks it is remembered by. `r` is its radius, `h` how far its
 *  crown stands above the ground at (u, z). */
export interface Bommie {
  u: number;
  z: number;
  r: number;
  h: number;
}

/** The reef-top place at world x nearest z that is on a spur, not in a
 *  sand channel: within ±5 m of z, the least channel. */
export function spurNear(x: number, z: number): { u: number; z: number } {
  let best = z;
  let sand = Infinity;
  for (let candidate = z + 5; candidate >= z - 5; candidate -= 0.5) {
    const c = channel(x - meander(candidate), candidate);
    if (c < sand) {
      sand = c;
      best = candidate;
    }
  }
  return { u: x - meander(best), z: best };
}

/** The bommie the dive's line passes: 3 m west of the camera as it sinks
 *  towards the reef top (timeline.ts DEPTH_KEYS), on the spur nearest
 *  z = −63, ahead of the lens through that stretch, with its chromis cloud
 *  and the reef's small fish about it. */
export const PATH_BOMMIE: Bommie = { ...spurNear(-11.5, -63), r: 2.4, h: 1.7 };

/** An anemone on the reef top, `r` its disc's radius. */
export interface Anemone {
  u: number;
  z: number;
  r: number;
}

/** The reef-top place at world x, between zFrom and zTo, where the crest
 *  bulges furthest east (a promontory, where the open reef top runs
 *  furthest out under the dive's line) and is on a spur. The rim stands
 *  1.5 m proud of the reef top, which tucks in under it: anything within
 *  a metre west of the rim line is in its shadow from the camera. */
export function promontoryNear(x: number, zFrom: number, zTo: number): { u: number; z: number } {
  let best = zFrom;
  let bulge = -Infinity;
  for (let z = zFrom; z >= zTo; z -= 0.5) {
    const m = meander(z);
    if (m > bulge && channel(x - m, z) < 0.3) {
      bulge = m;
      best = z;
    }
  }
  return { u: x - meander(best), z: best };
}

/** Anemones beside the dive's line, the first with its clownfish
 *  (schoolPaths.ts): half a metre west of the line, on promontories, so
 *  the camera passes over them with nothing in the way. */
export const ANEMONES: readonly Anemone[] = [
  { ...promontoryNear(-8.8, -58, -72), r: 0.7 },
  { ...promontoryNear(-9, -44, -54), r: 0.5 },
];

/** World position of an anemone's disc. */
export function anemoneTop(a: Anemone): Vec3 {
  return [crestX(a.u, a.z), reefTopY(a.u, a.z) + 0.15, a.z];
}

/** Bommies along the dive's line over the reef top, on the spurs, each
 *  standing clear of the camera's path (tests/dive/reefShape.test.ts). */
export const BOMMIES: readonly Bommie[] = [
  ...Array.from({ length: 14 }, (_, i) => {
    const r = 1.5 + 1.2 * hash1(i, REEF_SEED + 132);
    return {
      u: lerp(-26, -7, hash1(i, REEF_SEED + 130)),
      z: lerp(-14, -92, hash1(i, REEF_SEED + 131)),
      r,
      h: r * (0.55 + 0.25 * hash1(i, REEF_SEED + 133)),
    };
  }).filter((b) => channel(b.u, b.z) < 0.3 && Math.hypot(b.z - PATH_BOMMIE.z, b.u - PATH_BOMMIE.u) > 6),
  PATH_BOMMIE,
];

/** World position of a bommie's crown. */
export function bommieTop(b: Bommie): Vec3 {
  return [crestX(b.u, b.z), reefTopY(b.u, b.z) + b.h, b.z];
}
