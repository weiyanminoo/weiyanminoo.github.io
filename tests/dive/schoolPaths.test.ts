import { describe, it, expect } from 'vitest';
import { wallPose } from '../../src/scripts/dive/reefPaths';
import { SCHOOLS, fishPose } from '../../src/scripts/dive/schoolPaths';

const [blue, snapper, jacks, anthias] = SCHOOLS;

describe('the anthias', () => {
  // Small reef fish hover just off the face, whichever way the wall has
  // swung (reefPaths.ts): measured in the wall's own frame.
  it('hover within a few metres of the wall face', () => {
    for (const p of [0.33, 0.38, 0.41, 0.46, 0.52]) {
      const w = wallPose(p)!;
      for (let i = 0; i < anthias.count; i += 11) {
        const [x, , z] = fishPose(anthias, i, 15, p).position;
        // Undo the wall's turn about the camera, then measure off its face.
        const zWall = -x * Math.sin(-w.turn) + z * Math.cos(-w.turn);
        const off = zWall + w.distance;
        expect(off).toBeGreaterThanOrEqual(-0.5);
        expect(off).toBeLessThanOrEqual(5);
      }
    }
  });

  it('stay with the wall, not the camera, as the camera swims along it', () => {
    const along = (p: number) => {
      const w = wallPose(p)!;
      const [x, , z] = anthias.centre(15, p);
      return x * Math.cos(-w.turn) + z * Math.sin(-w.turn) - w.slide;
    };
    expect(along(0.56)).toBeCloseTo(along(0.46), 0);
  });
});

describe('fishPose', () => {
  it('is deterministic', () => {
    expect(fishPose(blue, 7, 12.3, 0.4)).toEqual(fishPose(blue, 7, 12.3, 0.4));
  });

  it('keeps every fish inside its school', () => {
    for (let t = 0; t < 60; t += 0.7) {
      for (let i = 0; i < blue.count; i += 37) {
        const p = fishPose(blue, i, t, 0.5).position;
        const c = blue.centre(t, 0.5);
        [0, 1, 2].forEach((k) => expect(Math.abs(p[k] - c[k])).toBeLessThanOrEqual(blue.radius[k] * 1.5));
      }
    }
  });

  it('gives unit headings that match the motion', () => {
    for (let i = 0; i < 20; i++) {
      const a = fishPose(blue, i, 5, 0.5);
      const b = fishPose(blue, i, 5.01, 0.5);
      const v = [0, 1, 2].map((k) => b.position[k] - a.position[k]);
      const len = Math.hypot(...v);
      const h = a.heading;
      expect(Math.hypot(...h)).toBeCloseTo(1, 5);
      expect((v[0] * h[0] + v[1] * h[1] + v[2] * h[2]) / len).toBeGreaterThan(0.9);
    }
  });

  // Every centre is camera-relative.
  it('crosses the snapper school over the lens at s = 0.5', () => {
    const c = snapper.centre(10, 0.5);
    expect(Math.hypot(c[0], c[2])).toBeLessThan(2);
  });

  it('mills the jacks around their own vertical axis, all one way', () => {
    let along = 0;
    for (let i = 0; i < jacks.count; i += 7) {
      const { position: p, heading: h } = fishPose(jacks, i, 20, 0.5);
      const c = jacks.centre(20, 0.5);
      const rx = p[0] - c[0];
      const rz = p[2] - c[2];
      const r = Math.hypot(rx, rz);
      if (r < 1) continue;
      // Counter-clockwise seen from above: the tangent is (-rz, rx) / r.
      const tangent = (h[0] * -rz + h[2] * rx) / r;
      expect(tangent).toBeGreaterThan(0.5);
      along++;
    }
    expect(along).toBeGreaterThan(20);
  });

  it('holds the jacks above and ahead of the camera', () => {
    for (let s = 0; s <= 1; s += 0.1) {
      const c = jacks.centre(20, s);
      expect(c[1]).toBeGreaterThan(4);
      expect(c[2]).toBeLessThan(-10);
    }
  });

  it('points the snapper the way the scroll sweeps them', () => {
    const before = snapper.centre(10, 0.4);
    const after = snapper.centre(10, 0.6);
    const sweep = after[0] - before[0];
    const h = fishPose(snapper, 3, 10, 0.5).heading;
    expect(Math.sign(h[0])).toBe(Math.sign(sweep));
  });
});
