// Mounts the dive on the landing page. The only module that touches the
// DOM: it measures the stations, turns scroll into progress, drives the
// render loop, and reports depth to the page. Everything it renders comes
// from diveStateAt/waterAt, so a frame depends on (progress, time) alone.
//
// Returns null — and leaves the page on its poster stills — when the film
// should not run: reduced motion, no WebGL2, or a scene that fails to start.

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { clamp } from './math';
import { anchorsFromLayout, focusFor, progressFromScroll, type Anchor } from './progress';
import { downgrade, pickTier, settingsFor, type Tier } from './quality';
import { createScene, type DiveScene, type Layer } from './scene';
import { SECTION_PROGRESS, SHOTS, diveStateAt } from './timeline';
import type { DiveFrame, DiveState, SectionId } from './types';
import { waterAt } from './water';
import createVolumeLayer from './layers/volume';
import createSurfaceLayer from './layers/surface';
import createShaftsLayer from './layers/shafts';
import createReefLayer from './layers/reef';
import createSchoolsLayer from './layers/schools';
import createFaunaLayer from './layers/fauna';
import createSnowLayer from './layers/snow';
import createBubblesLayer from './layers/bubbles';

export interface DiveHandle {
  seek(progress: number, timeS: number, entry?: number): Promise<void>;
  /** Plays the Dive-in back-roll burst from now. */
  startEntry(): void;
  /** The smooth scroller, when the film is running live (else null). */
  readonly lenis: Lenis | null;
  /** The film's ambient clock, which the breathing sound follows. */
  readonly timeS: number;
  dispose(): void;
}

export interface MountOptions {
  /** Called after every rendered frame (e.g. to drive the sound). */
  onFrame?(frame: DiveFrame): void;
}

/** Review mode adds read-only access to the storyboard, so the Node-side
 *  harness and audit read the same tables the scene renders from. */
export interface ReviewHandle extends DiveHandle {
  readonly shots: typeof SHOTS;
  readonly sections: typeof SECTION_PROGRESS;
  stateAt(progress: number): DiveState;
}

declare global {
  interface Window {
    __dive?: ReviewHandle;
  }
}

const ENTRY_S = 1.2;
// The depth event fires only when the reading changes by this much, so the
// gauge and audit listeners are not woken at 60 Hz for an unchanged number.
const DEPTH_EPSILON_M = 0.1;
const PULL_EPSILON = 0.005;
// A tab left in the background resumes without a violent jump in time.
const MAX_FRAME_S = 0.1;
// Runtime tier check (plan Task 19): after this many live frames (the
// first few skipped as warm-up), a median frame time above SLOW_FRAME_MS
// rebuilds the scene one tier down, once per page load.
const TIER_WARMUP_FRAMES = 10;
const TIER_SAMPLE_FRAMES = 120;
const SLOW_FRAME_MS = 22;

// Back to front: volume, surface, shafts, reef, schools, fauna, snow,
// bubbles.
function buildLayers(): Layer[] {
  return [
    createVolumeLayer(),
    createSurfaceLayer(),
    createShaftsLayer(),
    createReefLayer(),
    createSchoolsLayer(),
    createFaunaLayer(),
    createSnowLayer(),
    createBubblesLayer(),
  ];
}

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    // Give the probe's context back at once: browsers cap live contexts.
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!probe;
  } catch {
    return false;
  }
}

export function frameAt(progress: number, timeS: number, entry: number): DiveFrame {
  const state = diveStateAt(progress);
  return { state, water: waterAt(state.depth), timeS, entry };
}

export async function mountDive(root: HTMLElement, opts: MountOptions = {}): Promise<DiveHandle | null> {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const review = params.has('review');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('dive-canvas');

  // Shows the stills. Spacers collapse only if the film never started;
  // after a context loss the layout is kept (dive-off) so nothing jumps.
  // The stills were hidden from first paint, and Chrome never starts a
  // lazy image that was display:none at parse time once it is shown — so
  // they are switched to eager: they are needed now.
  const fallBack = (collapse: boolean) => {
    html.classList.remove('has-dive');
    if (collapse) html.classList.remove('dive-js');
    else html.classList.add('dive-off');
    for (const img of root.querySelectorAll<HTMLImageElement>('img.still')) img.loading = 'eager';
  };

  if ((reducedMotion && !review) || !(canvas instanceof HTMLCanvasElement) || !hasWebGL2()) {
    fallBack(true);
    return null;
  }

  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  let tier: Tier = pickTier({
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    dpr: window.devicePixelRatio,
    isMobile,
  });
  let settings = settingsFor(tier);

  // A context lost before the film is shown (driver reset, a mobile
  // browser's context cap) ends the mount: stills, in the compact layout.
  let lostEarly = false;
  const onEarlyLoss = () => {
    lostEarly = true;
  };
  canvas.addEventListener('webglcontextlost', onEarlyLoss);

  let scene: DiveScene;
  try {
    scene = await createScene(canvas, settings, buildLayers());
  } catch {
    canvas.removeEventListener('webglcontextlost', onEarlyLoss);
    fallBack(true);
    return null;
  }

  const stations = [...root.querySelectorAll<HTMLElement>('.station[data-section]')];
  let anchors: Anchor[] = [];
  // Station centres in document coordinates, re-read only when the layout
  // can have changed (resize, fonts, content reflow). The frame loop must
  // not read layout: interleaving those reads with its --pull writes forced
  // a style-and-layout pass per station per frame (~23 a frame, traced).
  let centres: number[] = [];

  // offsetTop, not getBoundingClientRect: the focus pull translates each
  // station's content, and the anchors must not move with it.
  const measure = () => {
    const vh = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    centres = stations.map((el) => el.offsetTop + el.offsetHeight / 2);
    anchors = anchorsFromLayout(
      stations.map((el, i) => ({ id: el.dataset.section as SectionId, centreY: centres[i] })),
      vh,
      maxScroll,
    );
  };

  const resize = () => {
    scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    measure();
  };

  resize();
  // Pre-roll: one frame of every shot, before the film is shown, so the
  // dive never stalls on a first draw mid-scroll (frame-cost audit).
  try {
    await scene.warm(SHOTS.map((s) => frameAt((s.from + s.to) / 2, 0, 1)));
  } catch {
    // A failed warm-up is only a slower first pass, not a broken dive.
  }
  canvas.removeEventListener('webglcontextlost', onEarlyLoss);
  if (lostEarly || scene.isLost()) {
    scene.dispose();
    fallBack(true);
    return null;
  }
  html.classList.add('has-dive');
  if (params.has('notext')) html.classList.add('review-notext');

  if (review) {
    const handle: ReviewHandle = {
      shots: SHOTS,
      sections: SECTION_PROGRESS,
      stateAt: diveStateAt,
      lenis: null,
      timeS: 0,
      // In review the entry is a seek argument, not a clock.
      startEntry() {},
      async seek(progress, timeS, entry = 1) {
        scene.render(frameAt(progress, timeS, entry));
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      },
      dispose() {
        scene.dispose();
        fallBack(false);
      },
    };
    window.__dive = handle;
    canvas.addEventListener('webglcontextlost', () => fallBack(false));
    return handle;
  }

  const lenis = new Lenis({ autoRaf: false });
  let timeS = 0;
  let last = performance.now();
  let rafId = 0;
  let running = true;
  let lastDepth = -Infinity;
  // -Infinity: entry reads 1 (no burst) until Dive in is pressed.
  let entryStartS = -Infinity;
  const pulls = new Map<HTMLElement, number>();
  const frameMs: number[] = [];
  let frames = 0;
  let rebuilding = false;
  let tierChecked = tier === 'low';

  // One tier down, keeping the scroll position; the loop skips rendering
  // while the new scene is built.
  const rebuild = async () => {
    rebuilding = true;
    tier = downgrade(tier);
    settings = settingsFor(tier);
    scene.dispose();
    try {
      scene = await createScene(canvas, settings, buildLayers());
      resize();
    } catch {
      toStills();
    }
    rebuilding = false;
  };

  const checkTier = (dtMs: number) => {
    frames++;
    if (frames <= TIER_WARMUP_FRAMES) return;
    frameMs.push(dtMs);
    if (frameMs.length < TIER_SAMPLE_FRAMES) return;
    tierChecked = true;
    const median = [...frameMs].sort((a, b) => a - b)[frameMs.length >> 1];
    if (median > SLOW_FRAME_MS) void rebuild();
  };

  const tick = (now: number) => {
    if (!running) return;
    const dtMs = now - last;
    timeS += clamp(dtMs / 1000, 0, MAX_FRAME_S);
    last = now;
    lenis.raf(now);
    if (rebuilding) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    // Only frames the visitor is actually watching count towards the tier.
    if (!tierChecked && !document.hidden) checkTier(dtMs);

    const scrollY = lenis.scroll;
    const progress = progressFromScroll(scrollY, anchors);
    const entry = clamp((timeS - entryStartS) / ENTRY_S, 0, 1);
    const frame = frameAt(progress, timeS, entry);
    scene.render(frame);
    opts.onFrame?.(frame);

    const vh = window.innerHeight;
    for (const [i, el] of stations.entries()) {
      const pull = focusFor(centres[i] - scrollY, vh / 2, vh);
      if (Math.abs((pulls.get(el) ?? -1) - pull) > PULL_EPSILON) {
        pulls.set(el, pull);
        el.style.setProperty('--pull', pull.toFixed(3));
      }
    }

    if (Math.abs(frame.state.depth - lastDepth) >= DEPTH_EPSILON_M) {
      lastDepth = frame.state.depth;
      window.dispatchEvent(new CustomEvent('dive:depth', { detail: { metres: lastDepth } }));
    }

    rafId = requestAnimationFrame(tick);
  };

  const observer = new ResizeObserver(() => measure());
  observer.observe(root);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  void document.fonts.ready.then(measure);

  // While hidden, rAF stops; on return, restart the clock from now so time
  // does not leap forward.
  const onVisibility = () => {
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
    observer.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    lenis.destroy();
  };

  // The film stops for good: the stills, in the film's layout, with no
  // leftover focus blur.
  const toStills = () => {
    stop();
    for (const el of stations) el.style.removeProperty('--pull');
    fallBack(false);
  };

  // Review Focus 4: a lost GPU context drops back to the stills, and Lenis
  // goes with it so native scrolling keeps working.
  canvas.addEventListener('webglcontextlost', toStills);

  rafId = requestAnimationFrame(tick);

  return {
    get lenis() {
      return running ? lenis : null;
    },
    get timeS() {
      return timeS;
    },
    async seek(progress, t, entry = 1) {
      scene.render(frameAt(progress, t, entry));
    },
    startEntry() {
      entryStartS = timeS;
    },
    dispose() {
      stop();
      scene.dispose();
      fallBack(false);
    },
  };
}
