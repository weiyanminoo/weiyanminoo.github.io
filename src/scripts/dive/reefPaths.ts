// Where the reef is, as a pure function of progress. The camera never moves
// in x/z (scene.ts), so "swimming towards the wall" is the reef moving
// towards the camera. Two pieces of reef, each on its own dolly track:
//
//   wall     a vertical face from 12 m down past 45 m. Forms out of the haze
//            ahead in `school`, fills the `wall` shot, and returns for the
//            `dropoff`, where the camera hangs off it looking down.
//   plateau  the reef top, 24.5 m deep, passing under the camera for
//            `reef-top`. The camera sinks through the manta and shark shots,
//            so the plateau must be behind it before it sinks that far.

import { lerp } from './math';

export const WALL_TOP_DEPTH_M = 12;
// Well below anything the camera reaches, so the face never ends in view:
// in the drop-off it falls away into the dark rather than to an edge.
export const WALL_BOTTOM_DEPTH_M = 70;
export const PLATEAU_TOP_DEPTH_M = 24.5;
export const PLATEAU_LENGTH_M = 40;

type Track = readonly (readonly [progress: number, value: number])[];

// [progress, metres from camera to the wall face]. Two visible spans.
const WALL_TRACKS: readonly Track[] = [
  [
    [0.2, 48],
    [0.24, 38],
    [0.32, 12],
    [0.37, 10.5],
  ],
  [
    // Back out of the haze for the drop-off, never popping in close.
    [0.72, 40],
    [0.76, 16],
    [0.8, 9],
    [0.9, 12],
  ],
];

// [progress, camera position along the plateau from its near edge].
const PLATEAU_TRACK: Track = [
  [0.5, 6],
  [0.58, 20],
  [0.66, 44],
];

function onTrack(track: Track, p: number): number | null {
  if (p < track[0][0] || p > track[track.length - 1][0]) return null;
  for (let i = 0; i < track.length - 1; i++) {
    const [p0, v0] = track[i];
    const [p1, v1] = track[i + 1];
    if (p <= p1) return lerp(v0, v1, (p - p0) / (p1 - p0));
  }
  return track[track.length - 1][1];
}

/** Metres from the camera to the wall face, or null when the wall is not
 *  in the film. */
export function wallDistance(progress: number): number | null {
  for (const track of WALL_TRACKS) {
    const d = onTrack(track, progress);
    if (d !== null) return d;
  }
  return null;
}

/** How far the camera has travelled over the plateau from its near edge
 *  (past PLATEAU_LENGTH_M it is beyond the far edge), or null when hidden. */
export function plateauTravel(progress: number): number | null {
  return onTrack(PLATEAU_TRACK, progress);
}
