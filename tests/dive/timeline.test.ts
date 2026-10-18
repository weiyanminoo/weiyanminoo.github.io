import { describe, it, expect } from 'vitest';
import { SHOTS, SECTION_PROGRESS, CAMERA_FOV_Y_DEG, diveStateAt } from '../../src/scripts/dive/timeline';

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
    expect(diveStateAt(0.03).camera.pitch).toBeGreaterThan(0.9);
    expect(diveStateAt(0.62).camera.pitch).toBeGreaterThan(0.6);
    expect(diveStateAt(0.82).camera.pitch).toBeLessThan(-0.3);
  });

  it('shows inserts only in their shots', () => {
    expect(diveStateAt(0.4).insert?.clip).toBe('wall');
    expect(diveStateAt(0.49).insert?.clip).toBe('slope');
    expect(diveStateAt(0.3).insert).toBeNull();
    expect(diveStateAt(0.55).insert).toBeNull();
    expect(diveStateAt(0.37).insert!.pushIn).toBeLessThan(diveStateAt(0.45).insert!.pushIn);
  });

  it('covers the cuts with events', () => {
    expect(diveStateAt(0.36).events.exhaleBurst).toBe(1);
    expect(diveStateAt(0.3).events.exhaleBurst).toBe(0);
    expect(diveStateAt(0.52).events.snapperCross).toBe(1);
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
    expect(diveStateAt(p.work).insert?.clip).toBe('wall');
    expect(['manta', 'shark']).toContain(diveStateAt(p.projects).shot);
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
