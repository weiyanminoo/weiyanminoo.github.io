// The water's optics as a pure function of depth. Every layer reads its
// colour and light from here, so every part of the water agrees.
//
// Fog stops are measured from reference 2's stills (spec §2): bright
// sky-blue near the surface, cobalt by 15 m, navy-black in the deep.

import { clamp, lerp, smoothstep } from './math';
import type { RGB, WaterSample } from './types';

export const FOG_STOPS = [
  [0, '#689fbd'],
  [15, '#2a5c7d'],
  [40, '#0a2135'],
] as const;

/** Per-metre attenuation by channel, roughly clear oceanic water: red is
 *  gone within a few metres, blue survives to the deep. */
export const ATTENUATION_PER_M: RGB = [0.35, 0.07, 0.03];

const MAX_DEPTH_M = 40;
// Shafts and caustics both read strongly near the surface and are gone by
// about 25 m (spec §6).
const LIGHT_GONE_M = 25;

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const STOP_RGB = FOG_STOPS.map(([d, hex]) => [d, hexToRgb(hex)] as const);

function fogAt(d: number): RGB {
  for (let i = 0; i < STOP_RGB.length - 1; i++) {
    const [d0, a] = STOP_RGB[i];
    const [d1, b] = STOP_RGB[i + 1];
    if (d <= d1) {
      const t = (d - d0) / (d1 - d0);
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
  }
  return STOP_RGB[STOP_RGB.length - 1][1];
}

export function waterAt(depthM: number): WaterSample {
  const d = clamp(depthM, 0, MAX_DEPTH_M);
  const light = 1 - smoothstep(0, LIGHT_GONE_M, d);
  return {
    fog: fogAt(d),
    fogDensity: lerp(0.03, 0.05, d / MAX_DEPTH_M),
    transmittance: [
      Math.exp(-ATTENUATION_PER_M[0] * d),
      Math.exp(-ATTENUATION_PER_M[1] * d),
      Math.exp(-ATTENUATION_PER_M[2] * d),
    ],
    shafts: light,
    caustics: light,
    ambient: 0.05 + 0.95 * Math.exp(-d / 12),
  };
}
