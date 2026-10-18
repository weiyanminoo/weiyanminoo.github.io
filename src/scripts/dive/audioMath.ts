// The pure parts of the dive's sound (spec §7): how the ambience bed
// changes with depth, and the visitor's remembered mute choice.

import { clamp, lerp } from './math';

const MAX_DEPTH_M = 40;
const SURFACE_HZ = 1800;
const DEEP_HZ = 400;
const MUTED_KEY = 'dive:muted';

/** Deeper is darker and quieter: the low-pass falls from 1800 Hz to 400 Hz
 *  (log-spaced, as hearing is) and the gain from 1 to 0.5 by 40 m. */
export function depthFilter(depthM: number): { lowpassHz: number; gain: number } {
  const t = clamp(depthM / MAX_DEPTH_M, 0, 1);
  return {
    lowpassHz: Math.round(Math.exp(lerp(Math.log(SURFACE_HZ), Math.log(DEEP_HZ), t))),
    gain: lerp(1, 0.5, t),
  };
}

/** True only for a stored mute. Missing, unreadable or throwing storage (a
 *  private window, blocked site data) is "no preference": Dive in still
 *  plays sound. */
export function readMuted(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Best effort: the choice lasts the session even if it cannot be stored. */
export function writeMuted(storage: Pick<Storage, 'setItem'> | null, muted: boolean): void {
  try {
    storage?.setItem(MUTED_KEY, String(muted));
  } catch {
    // Nothing to do: the in-memory choice still applies this visit.
  }
}
