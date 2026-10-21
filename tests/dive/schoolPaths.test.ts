import { describe, it, expect } from 'vitest';
import { SCHOOLS, fishPose } from '../../src/scripts/dive/schoolPaths';
import { positionAt } from '../../src/scripts/dive/timeline';
import { worldY } from '../../src/scripts/dive/world';
import { faceX } from '../../src/scripts/dive/reefShape';

const [blue, snapper, jacks, anthias] = SCHOOLS;

// Depth along the camera's path at a given z (the path only heads south).
function pathDepthAtZ(z: number): number {
  let p = 0;
  while (p < 1 && positionAt(p)[2] > z) p += 0.001;
  return -positionAt(p)[1] - 3;
}

describe('the anthias', () => {
  // Small reef fish hover just off the face, on the east side of the crest
  // line (world.ts), in a band that follows the dive down the wall.
  it('hover within a few metres of the real rock face', () => {
    const offs: number[] = [];
    for (let i = 0; i < anthias.count; i += 3) {
      const [x, y, z] = fishPose(anthias, i, 15, 0.6).position;
      offs.push(x - faceX(z, -y - 3));
    }
    offs.sort((p, q) => p - q);
    const at = (q: number) => offs[Math.floor(q * (offs.length - 1))];
    // Mostly a couple of metres out; the odd one tucked into a crevice or
    // out over one (the face's grooves are sharper than a fish's wander).
    expect(at(0.5)).toBeGreaterThanOrEqual(1);
    expect(at(0.5)).toBeLessThanOrEqual(4);
    expect(at(0.05)).toBeGreaterThanOrEqual(-1);
    expect(at(0.95)).toBeLessThanOrEqual(5.5);
  });

  it('follow the dive down the face', () => {
    for (let i = 0; i < anthias.count; i += 7) {
      const [, y, z] = fishPose(anthias, i, 15, 0.6).position;
      expect(Math.abs(y - worldY(pathDepthAtZ(z)))).toBeLessThan(6);
    }
  });

  it('stay put on the reef while the camera swims past', () => {
    expect(anthias.centre(15, 0.5)).toEqual(anthias.centre(15, 0.7));
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

  // Centres are in the dive site's own coordinates (world.ts).
  it('crosses the snapper school just ahead of the camera at s = 0.5', () => {
    const c = snapper.centre(10, 0.5);
    const cam = positionAt(0.42);
    expect(Math.hypot(c[0] - cam[0], c[2] - cam[2])).toBeLessThan(4);
    // Over the reef top, at the camera's height, not in the coral.
    expect(Math.abs(c[1] - cam[1])).toBeLessThan(1);
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

  it('holds the jacks above and ahead of the camera at the end of the dive', () => {
    const cam = positionAt(1);
    for (let s = 0; s <= 1; s += 0.1) {
      const c = jacks.centre(20, s);
      expect(c[1] - cam[1]).toBeGreaterThan(4);
      expect(c[2] - cam[2]).toBeLessThan(-4);
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
