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
    expect(settingsFor('low', { originals: true, isMobile: false })).toEqual({
      tier: 'low',
      maxDpr: 1,
      snowCount: 700,
      schoolScale: 0.35,
      post: false,
      footage: '540',
    });
  });

  it('uses 1080 footage only with camera originals', () => {
    expect(settingsFor('high', { originals: false, isMobile: false }).footage).toBe('720');
    expect(settingsFor('high', { originals: true, isMobile: false }).footage).toBe('1080');
  });

  it('always gives mobile 540 footage', () => {
    expect(settingsFor('medium', { originals: true, isMobile: true }).footage).toBe('540');
  });
});

describe('downgrade', () => {
  it('steps down and bottoms out at low', () => {
    expect(downgrade('high')).toBe('medium');
    expect(downgrade('low')).toBe('low');
  });
});
