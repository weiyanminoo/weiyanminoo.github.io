import { describe, it, expect } from 'vitest';
import { clamp, smoothstep, lerp } from '../../src/scripts/dive/math';

describe('clamp', () => {
  it('limits to the range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it('treats NaN as the lower bound', () => {
    expect(clamp(NaN, 0, 1)).toBe(0);
  });
});

describe('smoothstep', () => {
  it('is 0 at edge0, 1 at edge1 and 0.5 halfway', () => {
    expect(smoothstep(0, 25, 0)).toBe(0);
    expect(smoothstep(0, 25, 25)).toBe(1);
    expect(smoothstep(0, 25, 12.5)).toBe(0.5);
  });

  it('clamps outside the edges', () => {
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
  });
});

describe('lerp', () => {
  it('returns the endpoints exactly', () => {
    expect(lerp(0.4078, 0.1647, 0)).toBe(0.4078);
    expect(lerp(0.4078, 0.1647, 1)).toBe(0.1647);
  });
});
