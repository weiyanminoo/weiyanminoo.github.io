import { describe, it, expect } from 'vitest';
import {
  wallDistance,
  plateauTravel,
  PLATEAU_TOP_DEPTH_M,
  PLATEAU_LENGTH_M,
} from '../../src/scripts/dive/reefPaths';
import { diveStateAt } from '../../src/scripts/dive/timeline';

describe('wallDistance', () => {
  it('forms out of the haze: far at 0.24, 10–14 m at 0.32', () => {
    expect(wallDistance(0.24)!).toBeGreaterThanOrEqual(35);
    expect(wallDistance(0.32)!).toBeGreaterThanOrEqual(10);
    expect(wallDistance(0.32)!).toBeLessThanOrEqual(14);
  });

  it('is hidden during the inserts and back for the drop-off', () => {
    expect(wallDistance(0.4)).toBeNull();
    expect(wallDistance(0.5)).toBeNull();
    const d = wallDistance(0.82)!;
    expect(d).toBeGreaterThanOrEqual(6);
    expect(d).toBeLessThanOrEqual(16);
  });

  it('never reaches the lens', () => {
    for (let p = 0; p <= 1; p += 0.001) {
      const d = wallDistance(p);
      if (d !== null) expect(d).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('plateauTravel', () => {
  it('puts the camera over the plateau for the reef-top shot', () => {
    const t = plateauTravel(0.55)!;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(PLATEAU_LENGTH_M);
    const above = PLATEAU_TOP_DEPTH_M - diveStateAt(0.55).depth;
    expect(above).toBeGreaterThanOrEqual(3.5);
  });

  // The camera keeps sinking through the manta and shark shots; it must have
  // swum past the plateau's far edge before it drops near the plateau's top.
  it('is past the far edge before the camera sinks to the reef', () => {
    for (let p = 0; p <= 1; p += 0.001) {
      const t = plateauTravel(p);
      if (t === null) continue;
      if (diveStateAt(p).depth > PLATEAU_TOP_DEPTH_M - 1.5) expect(t).toBeGreaterThan(PLATEAU_LENGTH_M);
    }
  });

  it('is hidden outside its shots', () => {
    expect(plateauTravel(0.3)).toBeNull();
    expect(plateauTravel(0.8)).toBeNull();
  });
});
