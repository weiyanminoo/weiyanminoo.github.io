import { describe, it, expect } from 'vitest';
import {
  MAX_DEPTH,
  THERMOCLINE,
  bandForPath,
  depthAt,
  depthForColumn,
  depthForColumnProgress,
  normalisedDepth,
  isBelowThermocline,
} from '../../src/scripts/water/depth';

describe('bandForPath', () => {
  it('maps known paths to their bands', () => {
    expect(bandForPath('/')).toEqual({ top: 0, bottom: 32, zones: 'column' });
    expect(bandForPath('/work')).toEqual({ top: 5, bottom: 14, zones: 'single' });
    expect(bandForPath('/work/')).toEqual({ top: 5, bottom: 14, zones: 'single' });
    expect(bandForPath('/projects')).toEqual({ top: 12, bottom: 19, zones: 'single' });
    expect(bandForPath('/projects/')).toEqual({ top: 12, bottom: 19, zones: 'single' });
    expect(bandForPath('/outside')).toEqual({ top: 24, bottom: 32, zones: 'single' });
    expect(bandForPath('/outside/')).toEqual({ top: 24, bottom: 32, zones: 'single' });
  });

  it('falls back to the Home band for empty or unknown paths', () => {
    expect(bandForPath('')).toEqual({ top: 0, bottom: 32, zones: 'column' });
    expect(bandForPath('/nonsense')).toEqual({ top: 0, bottom: 32, zones: 'column' });
  });

  it('has overlapping adjacent bands down the chain of light pages', () => {
    const lightPaths = ['/', '/work', '/projects'];
    const bands = lightPaths.map(bandForPath);
    for (let i = 0; i < bands.length - 1; i++) {
      expect(bands[i].bottom).toBeGreaterThan(bands[i + 1].top);
    }
  });

  it('does not overlap Projects with Outside — they sit on opposite sides of the thermocline passage', () => {
    const projects = bandForPath('/projects');
    const outside = bandForPath('/outside');
    expect(projects.bottom).toBeLessThanOrEqual(outside.top);
  });

  it('has no single-zone band crossing THERMOCLINE — each single-zone page is entirely above or entirely below it', () => {
    const singleZonePaths = ['/work', '/projects', '/outside'];
    const bands = singleZonePaths.map(bandForPath);
    for (const band of bands) {
      expect(band.zones).toBe('single');
      expect(band.bottom <= THERMOCLINE || band.top >= THERMOCLINE).toBe(true);
    }
  });

  it('permits only the column band (Home) to cross THERMOCLINE', () => {
    const allPaths = ['/', '/work', '/projects', '/outside'];
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

  it('keeps Projects and Outside with deliberate margin past the measured contrast limits (Projects bottom <= 19m, Outside top >= 24m)', () => {
    // The bare contrast floor is 20m (deepest point where all dark-ink tokens
    // --ink, --ink-2, --ink-3 still clear 4.5:1) and 23m (shallowest point
    // where all on-deep tokens clear 4.5:1). Projects and Outside sit a metre
    // inside those, at 5.03:1 and 4.80:1 worst-case, rather than on the bare
    // floor: Phase 5's caustics, marine snow and dither overlay perturb the
    // background locally and would eat a 0.02 margin immediately. Moving
    // either boundary requires re-checking contrast against the palette stop
    // table.
    const projects = bandForPath('/projects');
    const outside = bandForPath('/outside');
    expect(projects.bottom).toBeLessThanOrEqual(19);
    expect(outside.top).toBeGreaterThanOrEqual(24);
  });

  it('strips a query string or hash before matching the segment', () => {
    expect(bandForPath('/work?tab=1')).toEqual({ top: 5, bottom: 14, zones: 'single' });
    expect(bandForPath('/work#section')).toEqual({ top: 5, bottom: 14, zones: 'single' });
  });

  it('tolerates a doubled leading slash and a trailing sub-path', () => {
    expect(bandForPath('//work')).toEqual({ top: 5, bottom: 14, zones: 'single' });
    expect(bandForPath('/work/something')).toEqual({ top: 5, bottom: 14, zones: 'single' });
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
