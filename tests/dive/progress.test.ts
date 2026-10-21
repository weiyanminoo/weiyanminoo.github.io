import { describe, it, expect } from 'vitest';
import { progressFromScroll, anchorsFromLayout, focusFor } from '../../src/scripts/dive/progress';
import { SECTION_PROGRESS } from '../../src/scripts/dive/timeline';

const A = [
  { y: 0, progress: 0 },
  { y: 1000, progress: 0.5 },
  { y: 3000, progress: 1 },
];

describe('progressFromScroll', () => {
  it('interpolates between anchors', () => {
    expect(progressFromScroll(500, A)).toBe(0.25);
    expect(progressFromScroll(2000, A)).toBe(0.75);
  });

  it('clamps outside the anchors and with none', () => {
    expect(progressFromScroll(-50, A)).toBe(0);
    expect(progressFromScroll(9e9, A)).toBe(1);
    expect(progressFromScroll(10, [])).toBe(0);
  });

  it('survives duplicate anchors', () => {
    const d = [
      { y: 0, progress: 0 },
      { y: 1000, progress: 0.5 },
      { y: 1000, progress: 0.6 },
      { y: 2000, progress: 1 },
    ];
    expect(progressFromScroll(1000, d)).toBe(0.6);
    expect(Number.isNaN(progressFromScroll(1000, d))).toBe(false);
  });
});

describe('anchorsFromLayout', () => {
  it('builds monotonic anchors with fixed ends', () => {
    const a = anchorsFromLayout(
      [
        { id: 'title', centreY: 300 },
        { id: 'work', centreY: 5000 },
        { id: 'school', centreY: 4800 },
      ],
      900,
      9000,
    );
    expect(a[0]).toEqual({ y: 0, progress: 0 });
    expect(a.at(-1)).toEqual({ y: 9000, progress: 1 });
    a.slice(1).forEach((x, i) => expect(x.y).toBeGreaterThanOrEqual(a[i].y));
  });

  // Review Focus 1: after a resize, a section's new position still maps to
  // its storyboard progress.
  it('keeps sections on their depth when re-measured', () => {
    for (const [vh, workY] of [
      [900, 5000],
      [390, 7400],
    ] as const) {
      const a = anchorsFromLayout([{ id: 'work', centreY: workY }], vh, 12000);
      expect(progressFromScroll(workY - vh / 2, a)).toBeCloseTo(SECTION_PROGRESS.work);
    }
  });

  it('handles sections taller than the viewport', () => {
    const a = anchorsFromLayout(
      [
        { id: 'work', centreY: 2600 },
        { id: 'school', centreY: 2700 },
      ],
      844,
      6000,
    );
    expect(progressFromScroll(2600 - 422, a)).toBeCloseTo(SECTION_PROGRESS.work);
  });
});

describe('focusFor', () => {
  // focusFor(textTop, textBottom, viewportCentre, viewportH), viewport px.
  it('is fully in focus whenever any of the text is at the viewport centre', () => {
    expect(focusFor(300, 600, 450, 900)).toBe(1);
    // A section taller than the screen (Work): sharp at its top and bottom.
    expect(focusFor(400, 2400, 450, 900)).toBe(1);
    expect(focusFor(-1500, 500, 450, 900)).toBe(1);
  });

  it('stays sharp just past its edges, then fades as the text leaves', () => {
    expect(focusFor(450 + 80, 1200, 450, 900)).toBe(1);
    expect(focusFor(450 + 300, 1200, 450, 900)).toBeGreaterThan(0);
    expect(focusFor(450 + 300, 1200, 450, 900)).toBeLessThan(1);
    expect(focusFor(450 + 500, 1500, 450, 900)).toBe(0);
    expect(focusFor(-900, 450 - 500, 450, 900)).toBe(0);
  });

  it('falls steadily with distance', () => {
    expect(focusFor(450 + 200, 1500, 450, 900)).toBeGreaterThan(focusFor(450 + 350, 1500, 450, 900));
  });
});
