import { describe, it, expect } from 'vitest';
import { hash1, noise1 } from '../../src/scripts/dive/noise';

describe('hash1', () => {
  it('is deterministic and in [0,1)', () => {
    for (let n = 0; n < 1000; n++) {
      const h = hash1(n, 7);
      expect(h).toBe(hash1(n, 7));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('gives different values for different seeds', () => {
    expect(hash1(3, 1)).not.toBe(hash1(3, 2));
  });
});

describe('noise1', () => {
  it('stays in [-1,1] and is continuous', () => {
    for (let x = 0; x < 50; x += 0.01) {
      expect(Math.abs(noise1(x))).toBeLessThanOrEqual(1);
      expect(Math.abs(noise1(x + 0.001) - noise1(x))).toBeLessThan(0.02);
    }
  });
});
