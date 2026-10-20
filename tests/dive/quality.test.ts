import { describe, it, expect } from 'vitest';
import { pickTier, settingsFor, downgrade } from '../../src/scripts/dive/quality';

describe('pickTier', () => {
  it('defaults desktop to high', () => {
    expect(pickTier({ dpr: 2, isMobile: false })).toBe('high');
  });

  it('caps mobile at medium', () => {
    expect(pickTier({ dpr: 3, isMobile: true })).toBe('medium');
  });

  it('gives low-memory devices low', () => {
    expect(pickTier({ dpr: 1, isMobile: false, deviceMemoryGB: 4 })).toBe('low');
  });

  it('steps down once for slow frames', () => {
    expect(pickTier({ dpr: 1, isMobile: false, medianFrameMs: 30 })).toBe('medium');
  });
});

describe('settingsFor', () => {
  it('matches the spec for the low tier', () => {
    expect(settingsFor('low')).toEqual({
      tier: 'low',
      maxDpr: 1,
      snowCount: 700,
      schoolScale: 0.35,
      post: false,
    });
  });

  it('gives each tier down less to draw', () => {
    const [high, medium, low] = (['high', 'medium', 'low'] as const).map(settingsFor);
    expect(high.snowCount).toBeGreaterThan(medium.snowCount);
    expect(medium.snowCount).toBeGreaterThan(low.snowCount);
    expect(high.schoolScale).toBeGreaterThan(medium.schoolScale);
    expect(medium.schoolScale).toBeGreaterThan(low.schoolScale);
  });
});

describe('downgrade', () => {
  it('steps down and bottoms out at low', () => {
    expect(downgrade('high')).toBe('medium');
    expect(downgrade('low')).toBe('low');
  });
});
