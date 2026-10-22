import { describe, it, expect } from 'vitest';
import { ANEMONES, BOMMIES, anemoneTop, bommieTop, channel, crestX, reefTopY } from '../../src/scripts/dive/reefShape';
import { positionAt } from '../../src/scripts/dive/timeline';

// The camera's nearest approach to a point, over the reef-top stretch of
// the dive.
function nearest(x: number, y: number, z: number): { horizontal: number; above: number } {
  let horizontal = Infinity;
  let above = Infinity;
  for (let p = 0.15; p <= 0.6; p += 0.002) {
    const c = positionAt(p);
    const h = Math.hypot(c[0] - x, c[2] - z);
    if (h < horizontal) {
      horizontal = h;
      above = c[1] - y;
    }
  }
  return { horizontal, above };
}

describe('the bommies', () => {
  it('stand on the spurs, not in the sand channels', () => {
    expect(BOMMIES.length).toBeGreaterThanOrEqual(8);
    for (const b of BOMMIES) expect(channel(b.u, b.z)).toBeLessThan(0.3);
  });

  it('stand clear of the camera, and one stands near its line', () => {
    const gaps = BOMMIES.map((b) => {
      const [x, y, z] = bommieTop(b);
      const { horizontal, above } = nearest(x, y, z);
      // Never under the camera's own line, and never up into it.
      expect(horizontal + Math.max(0, above)).toBeGreaterThan(3.5);
      return horizontal;
    });
    // But one close enough to swim past.
    expect(Math.min(...gaps)).toBeLessThan(9);
  });

  it('have anemones on the spurs beside the line', () => {
    for (const a of ANEMONES) {
      expect(channel(a.u, a.z)).toBeLessThan(0.3);
      const [x, y, z] = anemoneTop(a);
      const { horizontal, above } = nearest(x, y, z);
      expect(horizontal).toBeLessThan(5);
      // Tentacles stand 30 cm; the lens passes well over them.
      expect(above).toBeGreaterThan(2);
    }
  });

  it('rise from the ground where they stand', () => {
    for (const b of BOMMIES) {
      const [x, y, z] = bommieTop(b);
      expect(x).toBeCloseTo(crestX(b.u, b.z));
      expect(y - reefTopY(b.u, b.z)).toBeCloseTo(b.h);
      expect(z).toBe(b.z);
    }
  });
});
