// Where the reef is, as a pure function of progress. The camera never moves
// in x/z (scene.ts), so swimming is the reef moving past the camera. One
// set piece, in two spans:
//
//   wall   a vertical face from 12 m down past 45 m, 160 m long, with a
//          reef shelf at its foot (24.5 m deep, plunging away 34 m out).
//          It forms out of the haze ahead in `school`, and in `wall` swings
//          round to the camera's left — the camera turning to swim along it
//          — then slides past through `reef-top` before the camera drifts
//          out over the shelf's edge into the blue for the manta. It
//          returns, without the shelf, for the `dropoff`.
//
// Each span fades in from the fog colour and back out to it (`emerge`), so
// nothing pops in or out even where the fog alone would not hide it.

import { clamp, lerp, smoothstep } from './math';

export const WALL_TOP_DEPTH_M = 12;
// Well below anything the camera reaches, so the face never ends in view:
// in the drop-off it falls away into the dark rather than to an edge.
export const WALL_BOTTOM_DEPTH_M = 70;
export const WALL_HALF_LENGTH_M = 80;
export const PLATEAU_TOP_DEPTH_M = 24.5;
// The shelf's own length, from its inner edge (just inside the rock) to
// where it starts to plunge.
export const PLATEAU_LENGTH_M = 40;
// How far inside the face the shelf starts, so it meets the rock however
// the face's relief leans.
export const SHELF_INSET_M = 4;
/** Metres from the wall face to where the shelf plunges away. */
export const SHELF_EDGE_M = PLATEAU_LENGTH_M - 2 - SHELF_INSET_M;

export interface WallPose {
  /** Metres from the camera to the face, along the face's normal. */
  distance: number;
  /** Radians the wall has swung round the camera: 0 = ahead, facing it;
   *  π/2 = on the camera's left, running away ahead (the camera has turned
   *  right to swim along it). */
  turn: number;
  /** Metres along the face from the camera to the wall's centre; it falls
   *  as the camera swims along. */
  slide: number;
  /** 0 = fog colour, 1 = fully seen. */
  emerge: number;
  /** Whether the reef shelf at its foot is in the film. */
  shelf: boolean;
}

// [progress, distance, turn, slide].
type Key = readonly [p: number, distance: number, turn: number, slide: number];

interface Span {
  keys: readonly Key[];
  /** Progress over which it fades in from the fog, and back out. */
  fadeIn: readonly [number, number];
  fadeOut: readonly [number, number];
  shelf: boolean;
}

const QUARTER = Math.PI / 2;

const SPANS: readonly Span[] = [
  {
    keys: [
      [0.2, 48, 0, 20],
      [0.24, 38, 0, 20],
      [0.32, 12, 0, 20],
      [0.36, 10.5, 0, 20],
      // The turn: the face swings to the left as the camera turns right,
      // closing in a little to swim along it.
      [0.44, 8, QUARTER, 20],
      // Along the wall, over the shelf, at about the swimming pace of the
      // plateau before it (~170 m per unit of progress).
      [0.56, 8, QUARTER, 0],
      // Drifting out over the shelf's edge into the blue.
      [0.64, 45, QUARTER, -5],
    ],
    fadeIn: [0.2, 0.23],
    fadeOut: [0.61, 0.64],
    shelf: true,
  },
  {
    // Back out of the haze for the drop-off, never popping in close.
    keys: [
      [0.72, 40, 0, 0],
      [0.76, 16, 0, 0],
      [0.8, 9, 0, 0],
      [0.9, 12, 0, 0],
    ],
    fadeIn: [0.72, 0.74],
    fadeOut: [0.87, 0.9],
    shelf: false,
  },
];

export function wallPose(progress: number): WallPose | null {
  for (const span of SPANS) {
    const { keys } = span;
    if (progress < keys[0][0] || progress > keys[keys.length - 1][0]) continue;
    let i = 0;
    while (i < keys.length - 2 && progress > keys[i + 1][0]) i++;
    const [p0, d0, a0, s0] = keys[i];
    const [p1, d1, a1, s1] = keys[i + 1];
    const t = clamp((progress - p0) / (p1 - p0), 0, 1);
    // The turn eases in and out, like a swimmer's; distance and slide are
    // steady swimming.
    const eased = t * t * (3 - 2 * t);
    const emerge =
      smoothstep(span.fadeIn[0], span.fadeIn[1], progress) * (1 - smoothstep(span.fadeOut[0], span.fadeOut[1], progress));
    return {
      distance: lerp(d0, d1, t),
      turn: lerp(a0, a1, eased),
      slide: lerp(s0, s1, t),
      emerge,
      shelf: span.shelf,
    };
  }
  return null;
}
