import { describe, it, expect } from 'vitest';
import { smoothstep, colourAtDepth, rgbString, isDarkWater } from '../../src/scripts/water/palette';
import { isBelowThermocline } from '../../src/scripts/water/depth';

describe('smoothstep', () => {
  it('returns 0 at 0', () => {
    expect(smoothstep(0)).toBe(0);
  });

  it('returns 1 at 1', () => {
    expect(smoothstep(1)).toBe(1);
  });

  it('returns exactly 0.5 at 0.5', () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it('clamps below 0', () => {
    expect(smoothstep(-5)).toBe(0);
  });

  it('clamps above 1', () => {
    expect(smoothstep(5)).toBe(1);
  });
});

const STOPS: ReadonlyArray<[number, [number, number, number]]> = [
  [0, [246, 249, 249]],
  [6, [234, 242, 243]],
  [14, [207, 225, 228]],
  [19, [176, 207, 213]],
  [21, [150, 186, 196]],
  [23, [38, 88, 105]],
  [28, [20, 64, 83]],
  [32, [11, 42, 58]],
];

describe('colourAtDepth', () => {
  it('returns the exact table value at every stop', () => {
    for (const [metres, rgb] of STOPS) {
      expect(colourAtDepth(metres)).toEqual(rgb);
    }
  });

  it('clamps a negative depth to the 0m colour', () => {
    expect(colourAtDepth(-10)).toEqual([246, 249, 249]);
  });

  it('clamps 40m to the 32m colour', () => {
    expect(colourAtDepth(40)).toEqual([11, 42, 58]);
  });

  it('is monotonically non-increasing in every channel as depth increases', () => {
    let previous = colourAtDepth(0);
    for (let m = 0.5; m <= 32; m += 0.5) {
      const current = colourAtDepth(m);
      expect(current[0]).toBeLessThanOrEqual(previous[0]);
      expect(current[1]).toBeLessThanOrEqual(previous[1]);
      expect(current[2]).toBeLessThanOrEqual(previous[2]);
      previous = current;
    }
  });

  it('always returns integer channels in 0..255', () => {
    for (let m = 0; m <= 32; m += 0.7) {
      const [r, g, b] = colourAtDepth(m);
      for (const channel of [r, g, b]) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  // These two pin a mid-segment, non-midpoint depth to a hand-computed
  // expectation. They exist to catch the removal of smoothstep from
  // colourAtDepth: the exact-stop tests above only exercise t=0 and t=1,
  // where every easing function collapses to the same value, and
  // smoothstep(0.5) is exactly 0.5 so a midpoint check can't distinguish it
  // either. A linear (raw-fraction) implementation must fail these two.
  it('applies smoothstep, not a linear fraction, within the 0-6m segment', () => {
    // m=1.5 is 0.25 of the way from 0m to 6m. Linear would give
    // [243, 247, 248]; smoothstep(0.25) = 0.15625 gives [244, 248, 248].
    expect(colourAtDepth(1.5)).toEqual([244, 248, 248]);
  });

  it('applies smoothstep, not a linear fraction, within the 14-19m segment', () => {
    // m=15 is 0.2 of the way from 14m to 19m. Linear would give
    // [201, 221, 225]; smoothstep(0.2) = 0.104 gives [204, 223, 226].
    expect(colourAtDepth(15)).toEqual([204, 223, 226]);
  });
});

describe('rgbString', () => {
  it('formats as rgb(r, g, b)', () => {
    expect(rgbString([246, 249, 249])).toBe('rgb(246, 249, 249)');
    expect(rgbString([11, 42, 58])).toBe('rgb(11, 42, 58)');
  });
});

describe('isDarkWater', () => {
  it('is false at 0, 10 and 20 metres', () => {
    expect(isDarkWater(0)).toBe(false);
    expect(isDarkWater(10)).toBe(false);
    expect(isDarkWater(20)).toBe(false);
  });

  it('is true at 24, 28 and 32 metres', () => {
    expect(isDarkWater(24)).toBe(true);
    expect(isDarkWater(28)).toBe(true);
    expect(isDarkWater(32)).toBe(true);
  });

  it('agrees with isBelowThermocline on both sides of the boundary', () => {
    const points = [0, 10, 20, 20.999, 21, 21.001, 24, 28, 32];
    for (const metres of points) {
      expect(isDarkWater(metres)).toBe(isBelowThermocline(metres));
    }
  });
});

// Guards the stop table itself against an edit that breaks contrast without
// touching THERMOCLINE (the desync isDarkWater's delegation to
// isBelowThermocline can no longer catch, since it no longer inspects the
// table at all). Computes WCAG 2 relative-luminance contrast in the test
// itself against the site's actual text tokens.
describe('stop table contrast', () => {
  function hexToRgb(hex: string): Rgb {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [r, g, b];
  }

  function relativeLuminance([r, g, b]: Rgb): number {
    const linearise = (channel: number) => {
      const s = channel / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const [R, G, B] = [r, g, b].map(linearise);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  function contrastRatio(a: Rgb, b: Rgb): number {
    const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  it('keeps the water light enough for dark ink at 19m, the deepest point any light page renders', () => {
    // Not tested at THERMOCLINE (21m) itself: per the measured contrast
    // limits behind the band table (see depth.ts), --ink-2 is already down
    // to ~4.00:1 by 21m, and no page ever renders dark ink that deep —
    // Projects, the deepest light page, bottoms out at 19m. 19m is the
    // actual invariant this design depends on.
    const water = colourAtDepth(19);
    const inkTwo = hexToRgb('#31535E'); // --ink-2
    expect(contrastRatio(water, inkTwo)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the water dark enough for light text at 24m, the top of the Outside band', () => {
    const water = colourAtDepth(24);
    const onDeepThree = hexToRgb('#AECDD4'); // --on-deep-3
    expect(contrastRatio(water, onDeepThree)).toBeGreaterThanOrEqual(4.5);
  });
});
