// Pure maths for the water column's colour. No DOM, no canvas — a later task
// wires this to a canvas and a depth rail.

import { clamp, isBelowThermocline } from './depth';

export type Rgb = readonly [number, number, number];

export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

interface Stop {
  readonly metres: number;
  readonly rgb: Rgb;
}

// Metres to colour. Contrast-verified against the site's ink and on-deep
// text tokens — do not adjust, round, or "improve" these values.
const STOPS: readonly Stop[] = [
  { metres: 0, rgb: [246, 249, 249] },
  { metres: 6, rgb: [234, 242, 243] },
  { metres: 14, rgb: [207, 225, 228] },
  { metres: 19, rgb: [176, 207, 213] },
  { metres: 21, rgb: [150, 186, 196] },
  { metres: 23, rgb: [38, 88, 105] },
  { metres: 28, rgb: [20, 64, 83] },
  { metres: 32, rgb: [11, 42, 58] },
];

export function colourAtDepth(metres: number): Rgb {
  const m = clamp(metres, STOPS[0].metres, STOPS[STOPS.length - 1].metres);

  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (m >= a.metres && m <= b.metres) {
      const span = b.metres - a.metres;
      const t = smoothstep(span === 0 ? 0 : (m - a.metres) / span);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }

  // Unreachable given the clamp above, but keeps the return type sound.
  const last = STOPS[STOPS.length - 1].rgb;
  return [last[0], last[1], last[2]];
}

export function rgbString(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Delegates to isBelowThermocline rather than deriving its own threshold from
// the stop table: one source of truth for the light/dark boundary, so an
// edit to the stop table can never silently disagree with THERMOCLINE. The
// stop table itself is guarded separately, by tests asserting the colour at
// 19m (the deepest point any light page renders dark ink) still passes
// contrast for dark ink, and the colour at 24m (the top of the Outside band)
// still passes contrast for light text.
export function isDarkWater(metres: number): boolean {
  return isBelowThermocline(metres);
}
