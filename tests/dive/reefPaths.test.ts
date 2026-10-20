import { describe, it, expect } from 'vitest';
import {
  wallPose,
  PLATEAU_TOP_DEPTH_M,
  SHELF_EDGE_M,
  WALL_HALF_LENGTH_M,
} from '../../src/scripts/dive/reefPaths';
import { diveStateAt } from '../../src/scripts/dive/timeline';

const visible = (p: number) => wallPose(p) !== null;

describe('wallPose', () => {
  it('forms out of the haze: far at 0.24, 10–14 m at 0.32', () => {
    expect(wallPose(0.24)!.distance).toBeGreaterThanOrEqual(35);
    expect(wallPose(0.32)!.distance).toBeGreaterThanOrEqual(10);
    expect(wallPose(0.32)!.distance).toBeLessThanOrEqual(14);
  });

  it('stays in the film from the approach through the reef top', () => {
    for (let p = 0.22; p <= 0.58; p += 0.01) expect(visible(p)).toBe(true);
  });

  it('turns from ahead to the left, so the camera swims along it', () => {
    expect(wallPose(0.34)!.turn).toBe(0);
    expect(wallPose(0.46)!.turn).toBeCloseTo(Math.PI / 2, 5);
    // The turn eases in and out: no snap at either end.
    const a = wallPose(0.3605)!.turn - wallPose(0.36)!.turn;
    const b = wallPose(0.4)!.turn - wallPose(0.3995)!.turn;
    expect(a).toBeLessThan(b / 10);
  });

  it('slides past as the camera swims along it in the reef-top shot', () => {
    expect(wallPose(0.5)!.slide).toBeGreaterThan(wallPose(0.56)!.slide);
  });

  // The wall is a finite face: its ends must stay well out of the haze.
  it('keeps both ends of the face at least 40 m from the camera', () => {
    for (let p = 0; p <= 1; p += 0.001) {
      const w = wallPose(p);
      if (w) expect(WALL_HALF_LENGTH_M - Math.abs(w.slide)).toBeGreaterThanOrEqual(40);
    }
  });

  it('is back for the drop-off, ahead, without the shelf', () => {
    const w = wallPose(0.82)!;
    expect(w.distance).toBeGreaterThanOrEqual(6);
    expect(w.distance).toBeLessThanOrEqual(16);
    expect(w.turn).toBe(0);
    expect(w.shelf).toBe(false);
  });

  it('is out of the film for the manta, shark and the deep', () => {
    expect(visible(0.66)).toBe(false);
    expect(visible(0.7)).toBe(false);
    expect(visible(0.95)).toBe(false);
  });

  // Neither span may pop in or out: each starts far enough out that the
  // fog hides it, and fades from (and back to) the fog at its ends.
  it('only ever appears from far out in the haze, fully fogged', () => {
    let wasVisible = false;
    for (let p = 0; p <= 1; p += 0.001) {
      const w = wallPose(p);
      if (w && !wasVisible) {
        expect(w.distance).toBeGreaterThanOrEqual(35);
        expect(w.emerge).toBeLessThan(0.05);
      }
      if (!w && wasVisible) expect(wallPose(p - 0.001)!.emerge).toBeLessThan(0.05);
      wasVisible = w !== null;
    }
  });

  it('is fully emerged in the wall, reef-top and drop-off shots', () => {
    for (const p of [0.33, 0.41, 0.5, 0.56, 0.8]) expect(wallPose(p)!.emerge).toBe(1);
  });

  it('never reaches the lens', () => {
    for (let p = 0; p <= 1; p += 0.001) {
      const w = wallPose(p);
      if (w) expect(w.distance).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('the shelf at the wall’s foot', () => {
  it('puts the camera over it for the reef-top shot', () => {
    const w = wallPose(0.5)!;
    expect(w.shelf).toBe(true);
    expect(w.distance).toBeLessThan(SHELF_EDGE_M);
    expect(PLATEAU_TOP_DEPTH_M - diveStateAt(0.5).depth).toBeGreaterThanOrEqual(3.5);
  });

  // The camera keeps sinking through the manta and shark shots; it must have
  // drifted out past the shelf's edge before it drops near the shelf's top.
  it('is behind the camera before the camera sinks to it', () => {
    for (let p = 0; p <= 1; p += 0.001) {
      const w = wallPose(p);
      if (!w?.shelf) continue;
      if (diveStateAt(p).depth > PLATEAU_TOP_DEPTH_M - 1.5) expect(w.distance).toBeGreaterThan(SHELF_EDGE_M + 2);
    }
  });
});
