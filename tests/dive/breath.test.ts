import { describe, it, expect } from 'vitest';
import { breathAt } from '../../src/scripts/dive/breath';

describe('breathAt', () => {
  it('averages a 5 s cycle', () => {
    expect(breathAt(600).cycle).toBeGreaterThanOrEqual(119);
  });

  it('only ever moves forward', () => {
    for (let t = 0; t < 120; t += 0.01) {
      const a = breathAt(t);
      const b = breathAt(t + 0.01);
      expect(b.cycle + b.phase).toBeGreaterThan(a.cycle + a.phase);
    }
  });

  it('has no exhale during the inhale', () => {
    for (let t = 0; t < 60; t += 0.05) {
      const b = breathAt(t);
      if (b.phase < 0.4) expect(b.exhale).toBe(0);
    }
  });

  it('is deterministic', () => {
    expect(breathAt(123.4)).toEqual(breathAt(123.4));
  });
});
