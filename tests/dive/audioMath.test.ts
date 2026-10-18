import { describe, it, expect } from 'vitest';
import { depthFilter, readMuted, writeMuted } from '../../src/scripts/dive/audioMath';

describe('depthFilter', () => {
  it('filters harder and quieter with depth', () => {
    expect(depthFilter(0)).toEqual({ lowpassHz: 1800, gain: 1 });
    expect(depthFilter(40)).toEqual({ lowpassHz: 400, gain: 0.5 });
    expect(depthFilter(20).lowpassHz).toBeLessThan(depthFilter(10).lowpassHz);
  });
});

// Review Focus 5: private mode / blocked storage counts as "no preference".
describe('readMuted', () => {
  it('treats missing or throwing storage as no preference', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(readMuted(throwing)).toBe(false);
    expect(readMuted(null)).toBe(false);
    expect(readMuted({ getItem: () => null })).toBe(false);
  });

  it('reads a stored mute', () => {
    expect(readMuted({ getItem: () => 'true' })).toBe(true);
  });
});

describe('writeMuted', () => {
  it('never throws', () => {
    const throwing = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeMuted(throwing, false)).not.toThrow();
    expect(() => writeMuted(null, true)).not.toThrow();
  });
});
