import { describe, it, expect } from 'vitest';
import {
  MAX_DEPTH,
  THERMOCLINE,
  STILL,
  bandForPath,
  depthAt,
  depthForColumn,
  depthForColumnProgress,
  normalisedDepth,
  isBelowThermocline,
} from '../../src/scripts/water/depth';

describe('bandForPath', () => {
  const still = { top: STILL, bottom: STILL, zones: 'single' };

  it('maps Home to the column band, spanning the whole water column', () => {
    expect(bandForPath('/')).toEqual({ top: 0, bottom: MAX_DEPTH, zones: 'column' });
    expect(bandForPath('')).toEqual({ top: 0, bottom: MAX_DEPTH, zones: 'column' });
  });

  it('maps every sub-page to the same still band — the tabs share one flat colour', () => {
    expect(bandForPath('/work')).toEqual(still);
    expect(bandForPath('/work/')).toEqual(still);
    expect(bandForPath('/school')).toEqual(still);
    expect(bandForPath('/school/')).toEqual(still);
    expect(bandForPath('/projects')).toEqual(still);
    expect(bandForPath('/projects/')).toEqual(still);
    expect(bandForPath('/hobbies')).toEqual(still);
    expect(bandForPath('/hobbies/')).toEqual(still);
  });

  it('gives an unknown path the still band, not the descent', () => {
    // Anything that is not Home is a plain page; only Home descends.
    expect(bandForPath('/nonsense')).toEqual(still);
  });

  it('makes the still band flat, so its water never moves as the page scrolls', () => {
    const band = bandForPath('/work');
    expect(band.top).toBe(band.bottom);
    expect(depthAt(band, 0)).toBe(depthAt(band, 1));
  });

  it('keeps STILL well inside the measured dark-ink contrast limit', () => {
    // 20m is the deepest point where all three dark-ink tokens (--ink,
    // --ink-2, --ink-3) still clear 4.5:1 against the water. Every sub-page
    // renders dark ink, so STILL must sit above that with real margin —
    // Phase 5's caustics, marine snow and dither perturb the background
    // locally and would eat a bare-floor margin immediately.
    expect(STILL).toBeLessThan(20);
    expect(STILL).toBeLessThan(THERMOCLINE);
  });

  it('has no single-zone band crossing THERMOCLINE — each fixed-colour page is entirely above or entirely below it', () => {
    const singleZonePaths = ['/work', '/school', '/projects', '/hobbies', '/nonsense'];
    for (const band of singleZonePaths.map(bandForPath)) {
      expect(band.zones).toBe('single');
      expect(band.bottom <= THERMOCLINE || band.top >= THERMOCLINE).toBe(true);
    }
  });

  it('permits only the column band (Home) to cross THERMOCLINE', () => {
    const allPaths = ['/', '/work', '/school', '/projects', '/hobbies'];
    for (const path of allPaths) {
      const band = bandForPath(path);
      const crosses = band.top < THERMOCLINE && band.bottom > THERMOCLINE;
      if (crosses) {
        expect(band.zones).toBe('column');
      }
    }

    const home = bandForPath('/');
    expect(home.zones).toBe('column');
    expect(home.top).toBeLessThan(THERMOCLINE);
    expect(home.bottom).toBeGreaterThan(THERMOCLINE);
  });

  it('strips a query string or hash before matching the segment', () => {
    expect(bandForPath('/work?tab=1')).toEqual(still);
    expect(bandForPath('/work#section')).toEqual(still);
    expect(bandForPath('/?tab=1')).toEqual({ top: 0, bottom: MAX_DEPTH, zones: 'column' });
  });

  it('tolerates a doubled leading slash and a trailing sub-path', () => {
    expect(bandForPath('//work')).toEqual(still);
    expect(bandForPath('/work/something')).toEqual(still);
  });
});

describe('depthAt', () => {
  const band = { top: 6, bottom: 16 };

  it('returns band.top at progress 0', () => {
    expect(depthAt(band, 0)).toBe(6);
  });

  it('returns band.bottom at progress 1', () => {
    expect(depthAt(band, 1)).toBe(16);
  });

  it('returns the midpoint at progress 0.5', () => {
    expect(depthAt(band, 0.5)).toBe(11);
  });

  it('clamps progress below 0', () => {
    expect(depthAt(band, -1)).toBe(6);
  });

  it('clamps progress above 1', () => {
    expect(depthAt(band, 2)).toBe(16);
  });
});

describe('normalisedDepth', () => {
  it('gives 0 at 0 metres', () => {
    expect(normalisedDepth(0)).toBe(0);
  });

  it('gives 1 at MAX_DEPTH', () => {
    expect(normalisedDepth(MAX_DEPTH)).toBe(1);
  });

  it('gives 0.5 at 16 metres', () => {
    expect(normalisedDepth(16)).toBe(0.5);
  });

  it('clamps below 0', () => {
    expect(normalisedDepth(-10)).toBe(0);
  });

  it('clamps beyond MAX_DEPTH', () => {
    expect(normalisedDepth(MAX_DEPTH + 10)).toBe(1);
  });
});

describe('isBelowThermocline', () => {
  it('is false at exactly the thermocline', () => {
    expect(isBelowThermocline(THERMOCLINE)).toBe(false);
  });

  it('is true just above the thermocline', () => {
    expect(isBelowThermocline(THERMOCLINE + 0.001)).toBe(true);
  });

  it('is false just below the thermocline', () => {
    expect(isBelowThermocline(THERMOCLINE - 0.001)).toBe(false);
  });
});

describe('depthForColumn', () => {
  const documentHeight = 3200;
  const thermoclineY = 2000;

  it('returns 0 at the document top', () => {
    expect(depthForColumn(0, 0, documentHeight, thermoclineY)).toBe(0);
  });

  it('returns MAX_DEPTH at the document bottom', () => {
    expect(depthForColumn(documentHeight, 0, documentHeight, thermoclineY)).toBe(MAX_DEPTH);
  });

  it('returns THERMOCLINE exactly at the divider', () => {
    expect(depthForColumn(thermoclineY, 0, documentHeight, thermoclineY)).toBe(THERMOCLINE);
  });

  it('treats scrollY and viewportOffset as a single document-space position', () => {
    expect(depthForColumn(500, 500, documentHeight, thermoclineY)).toBe(
      depthForColumn(0, 1000, documentHeight, thermoclineY)
    );
  });

  it('clamps beyond the document bottom to MAX_DEPTH', () => {
    expect(depthForColumn(documentHeight, 500, documentHeight, thermoclineY)).toBe(MAX_DEPTH);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineY is zero', () => {
    expect(depthForColumn(0, 0, documentHeight, 0)).toBe(0);
    expect(depthForColumn(documentHeight, 0, documentHeight, 0)).toBe(MAX_DEPTH);
    expect(depthForColumn(documentHeight / 2, 0, documentHeight, 0)).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineY is negative', () => {
    expect(depthForColumn(documentHeight / 2, 0, documentHeight, -100)).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineY is at the document height', () => {
    expect(depthForColumn(documentHeight / 2, 0, documentHeight, documentHeight)).toBeCloseTo(
      MAX_DEPTH / 2
    );
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineY is beyond the document height', () => {
    expect(
      depthForColumn(documentHeight / 2, 0, documentHeight, documentHeight + 500)
    ).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('does not divide by zero when documentHeight is 0', () => {
    expect(depthForColumn(0, 0, 0, 0)).toBe(0);
  });
});

describe('depthForColumnProgress', () => {
  const thermoclineProgress = 0.625;

  it('returns 0 at progress 0', () => {
    expect(depthForColumnProgress(0, thermoclineProgress)).toBe(0);
  });

  it('returns MAX_DEPTH at progress 1', () => {
    expect(depthForColumnProgress(1, thermoclineProgress)).toBe(MAX_DEPTH);
  });

  it('returns THERMOCLINE exactly at the divider progress', () => {
    expect(depthForColumnProgress(thermoclineProgress, thermoclineProgress)).toBe(THERMOCLINE);
  });

  it('clamps progress below 0', () => {
    expect(depthForColumnProgress(-1, thermoclineProgress)).toBe(0);
  });

  it('clamps progress above 1', () => {
    expect(depthForColumnProgress(2, thermoclineProgress)).toBe(MAX_DEPTH);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineProgress is 0', () => {
    expect(depthForColumnProgress(0, 0)).toBe(0);
    expect(depthForColumnProgress(1, 0)).toBe(MAX_DEPTH);
    expect(depthForColumnProgress(0.5, 0)).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineProgress is negative', () => {
    expect(depthForColumnProgress(0.5, -0.2)).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineProgress is 1', () => {
    expect(depthForColumnProgress(0.5, 1)).toBeCloseTo(MAX_DEPTH / 2);
  });

  it('falls back to a straight 0-to-MAX_DEPTH linear mapping when thermoclineProgress is greater than 1', () => {
    expect(depthForColumnProgress(0.5, 1.4)).toBeCloseTo(MAX_DEPTH / 2);
  });
});
