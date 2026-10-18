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
import { pickTier, settingsFor } from './quality';
import { createScene, type DiveScene, type Layer } from './scene';
import { SECTION_PROGRESS, SHOTS, diveStateAt } from './timeline';
import type { DiveFrame, DiveState, SectionId } from './types';
import { waterAt } from './water';
import createVolumeLayer from './layers/volume';
import createSurfaceLayer from './layers/surface';
import createShaftsLayer from './layers/shafts';
import createReefLayer from './layers/reef';
import createSchoolsLayer from './layers/schools';
import createSnowLayer from './layers/snow';
import createBubblesLayer from './layers/bubbles';

export interface DiveHandle {
  seek(progress: number, timeS: number, entry?: number): Promise<void>;
  dispose(): void;
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

// Back to front (plan Phase 3): volume, surface, shafts, reef, schools,
// fauna, snow, bubbles.
function buildLayers(): Layer[] {
  return [
    createVolumeLayer(),
    createSurfaceLayer(),
    createShaftsLayer(),
    createReefLayer(),
    createSchoolsLayer(),
    createSnowLayer(),
    createBubblesLayer(),
  ];
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function frameAt(progress: number, timeS: number, entry: number): DiveFrame {
  const state = diveStateAt(progress);
  return { state, water: waterAt(state.depth), timeS, entry };
}

export async function mountDive(root: HTMLElement): Promise<DiveHandle | null> {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const review = params.has('review');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('dive-canvas');

  // Shows the stills. Spacers collapse only if the film never started;
  // after a context loss the layout is kept (dive-off) so nothing jumps.
  const fallBack = (collapse: boolean) => {
    html.classList.remove('has-dive');
    if (collapse) html.classList.remove('dive-js');
    else html.classList.add('dive-off');
  };

  if ((reducedMotion && !review) || !(canvas instanceof HTMLCanvasElement) || !hasWebGL2()) {
    fallBack(true);
    return null;
  }

  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  const tier = pickTier({
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    dpr: window.devicePixelRatio,
    isMobile,
  });
  const settings = settingsFor(tier, { originals: false, isMobile });

  let scene: DiveScene;
  try {
    scene = await createScene(canvas, settings, buildLayers());
  } catch {
    fallBack(true);
    return null;
  }

  const stations = [...root.querySelectorAll<HTMLElement>('.station[data-section]')];
  let anchors: Anchor[] = [];

  // offsetTop, not getBoundingClientRect: the focus pull translates each
  // station's content, and the anchors must not move with it.
  const measure = () => {
    const vh = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    anchors = anchorsFromLayout(
      stations.map((el) => ({
        id: el.dataset.section as SectionId,
        centreY: el.offsetTop + el.offsetHeight / 2,
      })),
      vh,
      maxScroll,
    );
  };

  const resize = () => {
    scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    measure();
  };

  html.classList.add('has-dive');
  if (params.has('notext')) html.classList.add('review-notext');
  resize();

  if (review) {
    const handle: ReviewHandle = {
      shots: SHOTS,
      sections: SECTION_PROGRESS,
      stateAt: diveStateAt,
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
  const entryStartS = -Infinity;
  const pulls = new Map<HTMLElement, number>();

  const tick = (now: number) => {
    if (!running) return;
    timeS += clamp((now - last) / 1000, 0, MAX_FRAME_S);
    last = now;
    lenis.raf(now);

    const scrollY = lenis.scroll;
    const progress = progressFromScroll(scrollY, anchors);
    const entry = clamp((timeS - entryStartS) / ENTRY_S, 0, 1);
    const frame = frameAt(progress, timeS, entry);
    scene.render(frame);

    const vh = window.innerHeight;
    for (const el of stations) {
      const pull = focusFor(el.offsetTop + el.offsetHeight / 2 - scrollY, vh / 2, vh);
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

  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
    observer.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
    lenis.destroy();
  };

  // Review Focus 4: a lost GPU context drops back to the stills, and Lenis
  // goes with it so native scrolling keeps working.
  canvas.addEventListener('webglcontextlost', () => {
    stop();
    for (const el of stations) el.style.removeProperty('--pull');
    fallBack(false);
  });

  // While hidden, rAF stops; on return, restart the clock from now so time
  // does not leap forward.
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });

  rafId = requestAnimationFrame(tick);

  return {
    async seek(progress, t, entry = 1) {
      scene.render(frameAt(progress, t, entry));
    },
    dispose() {
      stop();
      scene.dispose();
      fallBack(false);
    },
  };
}
