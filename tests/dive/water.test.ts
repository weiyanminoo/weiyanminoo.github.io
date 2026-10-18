import { describe, it, expect } from 'vitest';
import { waterAt, hexToRgb, FOG_STOPS } from '../../src/scripts/dive/water';

describe('hexToRgb', () => {
  it('parses a hex colour into 0..1 channels', () => {
    expect(hexToRgb('#689fbd')).toEqual([0x68 / 255, 0x9f / 255, 0xbd / 255]);
  });
});

describe('waterAt', () => {
  it('hits each fog stop exactly', () => {
    for (const [d, hex] of FOG_STOPS) expect(waterAt(d).fog).toEqual(hexToRgb(hex));
  });

  it('clamps outside 0–40 m', () => {
    expect(waterAt(-3)).toEqual(waterAt(0));
    expect(waterAt(90)).toEqual(waterAt(40));
  });

  it('loses red before blue', () => {
    const t = waterAt(5).transmittance;
    expect(t[0]).toBeLessThan(0.2);
    expect(t[2]).toBeGreaterThan(0.85);
  });

  it('never lets transmittance rise with depth', () => {
    for (let d = 0; d < 40; d += 0.5) {
      for (const c of [0, 1, 2]) {
        expect(waterAt(d + 0.5).transmittance[c]).toBeLessThanOrEqual(waterAt(d).transmittance[c]);
      }
    }
  });

  it('has full shafts and caustics at 0 m, gone by 25 m', () => {
    for (const k of ['shafts', 'caustics'] as const) {
      expect(waterAt(0)[k]).toBe(1);
      expect(waterAt(25)[k]).toBe(0);
      expect(waterAt(12)[k]).toBeGreaterThan(waterAt(18)[k]);
    }
  });

  it('makes the deep dark but not black', () => {
    expect(waterAt(40).ambient).toBeGreaterThanOrEqual(0.05);
    expect(waterAt(40).ambient).toBeLessThan(waterAt(10).ambient);
  });

  it('runs fog density from 0.03 to 0.05', () => {
    expect(waterAt(0).fogDensity).toBeCloseTo(0.03);
    expect(waterAt(40).fogDensity).toBeCloseTo(0.05);
  });
});
