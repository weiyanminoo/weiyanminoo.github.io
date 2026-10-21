// The wall face's shape, as pure functions of position: the reef layer
// builds its mesh from these, and the dive path and the anthias read the
// same numbers to stay a set distance off the real rock. Nothing here
// imports Three.js.

import { lerp, smoothstep } from './math';
import { hash1 } from './noise';
import { EDGE_X, REEF_NORTH_Z, REEF_SOUTH_Z, REEF_TOP_DEPTH_M, WALL_BOTTOM_DEPTH_M } from './world';

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
