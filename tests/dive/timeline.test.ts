import { describe, it, expect } from 'vitest';
import { SHOTS, SECTION_PROGRESS, CAMERA_FOV_Y_DEG, diveStateAt } from '../../src/scripts/dive/timeline';
import { EDGE_X, REEF_TOP_DEPTH_M } from '../../src/scripts/dive/world';

describe('SHOTS', () => {
  it('tiles [0,1] with no gaps', () => {
    expect(SHOTS[0].from).toBe(0);
    expect(SHOTS.at(-1)!.to).toBe(1);
    SHOTS.slice(1).forEach((s, i) => expect(s.from).toBe(SHOTS[i].to));
  });
});

describe('diveStateAt', () => {
  it('starts at the surface and ends in the deep', () => {
    expect(diveStateAt(0)).toMatchObject({ shot: 'surface', depth: 0 });
    expect(diveStateAt(1)).toMatchObject({ shot: 'deep', depth: 40 });
  });

  it('keeps depth continuous and never rising', () => {
    let prev = 0;
    for (let i = 0; i <= 1000; i++) {
      const d = diveStateAt(i / 1000).depth;
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d - prev).toBeLessThan(0.2);
      prev = d;
    }
  });

  it('keeps the camera continuous', () => {
    for (let i = 0; i < 1000; i++) {
      const a = diveStateAt(i / 1000).camera;
      const b = diveStateAt((i + 1) / 1000).camera;
      expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(0.05);
      expect(Math.abs(a.yaw - b.yaw)).toBeLessThan(0.05);
    }
  });

  it('frames the key shots', () => {
    // Looking up at the surface, but low enough that Snell's window stays
    // in the top of the frame, clear of the title (contrast audit).
    expect(diveStateAt(0.03).camera.pitch).toBeGreaterThan(0.4);
    expect(diveStateAt(0.03).camera.pitch).toBeLessThan(0.55);
    // Over the edge: looking down the face, which is on the left.
    expect(diveStateAt(0.5).camera.pitch).toBeLessThan(-0.5);
    expect(diveStateAt(0.5).camera.yaw).toBeGreaterThan(0.2);
    // Up into the blue for the manta; out to the right for the shark
    // (faunaPaths.test.ts checks each is in the middle of the frame).
    expect(diveStateAt(0.62).camera.pitch).toBeGreaterThan(0.5);
    expect(diveStateAt(0.69).camera.yaw).toBeLessThan(-0.4);
    expect(diveStateAt(0.82).camera.pitch).toBeLessThan(-0.3);
  });

  it('tells the dive in order: blue, reef top, over the edge, down the wall', () => {
    expect(diveStateAt(0.15).shot).toBe('descent');
    expect(diveStateAt(0.4).shot).toBe('reef-top');
    expect(diveStateAt(0.5).shot).toBe('dropoff');
    expect(diveStateAt(0.56).shot).toBe('wall');
    expect(diveStateAt(0.82).shot).toBe('deep-wall');
  });

  it('times the snapper crossing to the reef top', () => {
    expect(diveStateAt(0.42).events.snapperCross).toBe(1);
    expect(diveStateAt(0.3).events.snapperCross).toBe(0);
  });
});

// The camera swims a real path through one fixed reef (world.ts).
describe('the dive path', () => {
  const at = (p: number) => diveStateAt(p).position;

  it('swims smoothly and never backwards', () => {
    for (let i = 0; i < 1000; i++) {
      const a = at(i / 1000);
      const b = at((i + 1) / 1000);
      expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeLessThan(0.4);
      expect(b[2]).toBeLessThanOrEqual(a[2] + 1e-9);
    }
  });

  it('starts in the blue beside the reef', () => {
    expect(at(0.03)[0]).toBeGreaterThan(EDGE_X + 5);
  });

  it('settles over the reef top, never closer than 3 m to it', () => {
    expect(at(0.4)[0]).toBeLessThan(EDGE_X);
    for (let p = 0; p <= 1; p += 0.002) {
      if (at(p)[0] < EDGE_X) expect(REEF_TOP_DEPTH_M - diveStateAt(p).depth).toBeGreaterThanOrEqual(3);
    }
  });

  it('goes over the edge in the drop-off shot', () => {
    expect(at(0.47)[0]).toBeLessThan(EDGE_X);
    expect(at(0.53)[0]).toBeGreaterThan(EDGE_X);
  });

  it('then drifts down the face with the wall close on the left', () => {
    for (let p = 0.56; p <= 0.88; p += 0.01) {
      const x = at(p)[0];
      expect(x).toBeGreaterThanOrEqual(EDGE_X + 6);
      expect(x).toBeLessThanOrEqual(EDGE_X + 12);
    }
  });

  it('puts the camera at its depth', () => {
    for (const p of [0, 0.3, 0.7, 1]) expect(at(p)[1]).toBeCloseTo(-(diveStateAt(p).depth + 3), 6);
  });

  it('ramps events from 0 before to 1 after', () => {
    expect(diveStateAt(0.5).events.manta).toBe(0);
    expect(diveStateAt(0.7).events.manta).toBe(1);
    expect(diveStateAt(0.69).events.shark).toBeCloseTo(0.5, 1);
  });

  it('clamps and survives NaN', () => {
    expect(diveStateAt(-1)).toEqual(diveStateAt(0));
    expect(diveStateAt(2)).toEqual(diveStateAt(1));
    expect(diveStateAt(NaN)).toEqual(diveStateAt(0));
  });
});

describe('SECTION_PROGRESS', () => {
  it('runs in spec order and lands each section in its shot', () => {
    const p = SECTION_PROGRESS;
    const order = [p.title, p.about, p.work, p.school, p.projects, p.hobbies, p.contact];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(diveStateAt(p.work).shot).toBe('reef-top');
    expect(diveStateAt(p.school).shot).toBe('dropoff');
    expect(['manta', 'shark']).toContain(diveStateAt(p.projects).shot);
    expect(diveStateAt(p.hobbies).shot).toBe('deep-wall');
    expect(diveStateAt(p.contact).shot).toBe('deep');
  });
});

describe('CAMERA_FOV_Y_DEG', () => {
  // Spec §6: a 20–24 mm full-frame lens. Vertical FOV = 2·atan(12 / f).
  it('matches a 20–24 mm full-frame lens', () => {
    const focal = 12 / Math.tan((CAMERA_FOV_Y_DEG * Math.PI) / 360);
    expect(focal).toBeGreaterThanOrEqual(20);
    expect(focal).toBeLessThanOrEqual(24);
  });
});
