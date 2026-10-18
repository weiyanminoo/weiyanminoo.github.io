// Scroll position → dive progress. The page is ordinary flowing HTML, so a
// section's position depends on its content and the viewport; instead of
// hard-coding scroll lengths, each station's measured centre becomes an
// anchor pinned to its storyboard progress, and scroll interpolates between
// anchors. Re-measuring after a resize keeps every section on its depth.

import { clamp, lerp, smoothstep } from './math';
import { SECTION_PROGRESS } from './timeline';
import type { SectionId } from './types';

export interface Anchor {
  /** Scroll position (px) at which `progress` applies. */
  y: number;
  progress: number;
}

export function progressFromScroll(scrollY: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 0;
  // The last anchor at or above this scroll position. With duplicate y
  // values (sections collapsed onto one point) that is the later anchor,
  // so the later progress wins and no zero-length segment is divided by.
  let k = -1;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].y <= scrollY) k = i;
    else break;
  }
  if (k === -1) return clamp(anchors[0].progress, 0, 1);
  if (k === anchors.length - 1) return clamp(anchors[k].progress, 0, 1);
  const a = anchors[k];
  const b = anchors[k + 1];
  return clamp(lerp(a.progress, b.progress, (scrollY - a.y) / (b.y - a.y)), 0, 1);
}

/** Anchors for stations given in document order. A station is "at" its
 *  progress when its centre crosses the viewport's centre. */
export function anchorsFromLayout(
  sections: readonly { id: SectionId; centreY: number }[],
  viewportH: number,
  maxScroll: number,
): Anchor[] {
  const anchors: Anchor[] = [{ y: 0, progress: 0 }];
  let prevY = 0;
  for (const { id, centreY } of sections) {
    const y = Math.max(prevY, clamp(centreY - viewportH / 2, 0, maxScroll));
    anchors.push({ y, progress: SECTION_PROGRESS[id] });
    prevY = y;
  }
  anchors.push({ y: Math.max(prevY, maxScroll), progress: 1 });
  return anchors;
}

/** How in-focus a station's text is: 1 at the viewport's centre, 0 once its
 *  centre is 0.6 of a viewport away. */
export function focusFor(sectionCentreY: number, viewportCentreY: number, viewportH: number): number {
  return 1 - smoothstep(0, 0.6 * viewportH, Math.abs(sectionCentreY - viewportCentreY));
}
