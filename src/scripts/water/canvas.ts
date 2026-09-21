// Paints the water column onto a full-viewport canvas, driven by an
// animation loop. Repaints on scroll, resize, and after navigation, and once
// per frame while the loop runs. Phase 5b adds marine snow, a shoal and
// bubbles on top of this; add those by importing them into EFFECTS below,
// not by restructuring this module.

import { bandForPath, depthAt, depthForColumn, depthForColumnProgress, type ZonedBand } from './depth';
import { colourAtDepth, rgbString } from './palette';
import type { Effect, WaterFrame } from './effects/types';
import dither from './effects/dither';
import caustics from './effects/caustics';
import shafts from './effects/shafts';
import snow from './effects/snow';
import shoal from './effects/shoal';
import bubbles from './effects/bubbles';

const GRADIENT_STOPS = 12;
const MAX_DEVICE_PIXEL_RATIO = 2;
// Stable hook for the thermocline divider on the `column` band (Home) — see
// index.astro. Not a class, so a future restyle can't rename it out from
// under this query.
const THERMOCLINE_ELEMENT_ID = 'thermocline';

// Ordered: each is drawn on top of the last, over the base gradient.
const EFFECTS: readonly Effect[] = [dither, caustics, shafts, snow, shoal, bubbles];

// The depth rail only needs a new `water:depth` event when what it would
// render actually changes — its listener writes textContent, style.top and
// toggles a class on every dispatch, a forced style recalculation the loop
// must not trigger at 60Hz for a readout that only changes on scroll.
const DEPTH_DISPATCH_PROGRESS_EPSILON = 0.001;

// Guards against mounting the same canvas twice (e.g. a stray re-run of its
// script) — returns the existing teardown instead of attaching a second set
// of listeners.
const teardowns = new WeakMap<HTMLCanvasElement, () => void>();

/** scrollY expressed as progress through the scrollable range, 0 on a page
 *  that does not scroll rather than NaN. */
function scrollProgress(scrollY: number, scrollableHeight: number): number {
  return scrollableHeight > 0 ? scrollY / scrollableHeight : 0;
}

export function mountWater(canvas: HTMLCanvasElement): () => void {
  const existing = teardowns.get(canvas);
  if (existing) {
    return existing;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  let band: ZonedBand = bandForPath(location.pathname);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Document-space centre of the thermocline divider, for the `column`
  // band. 0 (the depthForColumn degenerate-guard value) when the divider is
  // absent, e.g. on a `single` page. Re-read on resize and navigation,
  // since content reflows and the divider moves.
  let thermoclineY = 0;

  function updateThermoclineY(): void {
    const el = document.getElementById(THERMOCLINE_ELEMENT_ID);
    if (!el) {
      thermoclineY = 0;
      return;
    }
    const rect = el.getBoundingClientRect();
    thermoclineY = rect.top + window.scrollY + rect.height / 2;
  }

  // Advances only while the loop is running, so a page left in a background
  // tab does not jump forward violently when it resumes.
  let time = 0;
  let looping = false;
  let rafId: number | undefined;
  let lastTimestamp: number | null = null;

  // water:depth dispatch de-duplication state — see paint() below.
  let lastDispatchedMetres: number | null = null;
  let lastDispatchedProgress: number | null = null;
  // Always dispatch the first paint, and always again right after
  // astro:after-swap (the rail is re-rendered fresh on navigation and needs
  // a value even if it happens to match the last one this module sent).
  let forceDepthDispatch = true;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    // Drawing operations below are then expressed in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateThermoclineY();
  }

  function paint(): void {
    const viewportHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollableHeight = documentHeight - viewportHeight;

    let depthTop: number;
    let depthBottom: number;
    let progressTop: number;
    // The rail's numeric readout, deliberately not always the same value as
    // depthTop — see depthForColumnProgress's own comment in depth.ts for
    // why. depthTop/depthBottom below are for the gradient only: they stay
    // on true viewport-top/viewport-bottom document positions because that
    // is physically correct for what is painted on screen. Do not "fix"
    // this to match the readout, or vice versa — they intentionally
    // diverge.
    let readoutMetres: number;

    if (band.zones === 'column') {
      depthTop = depthForColumn(window.scrollY, 0, documentHeight, thermoclineY);
      depthBottom = depthForColumn(window.scrollY, viewportHeight, documentHeight, thermoclineY);
      progressTop = scrollProgress(window.scrollY, scrollableHeight);
      const thermoclineProgress = scrollableHeight > 0 ? thermoclineY / scrollableHeight : 0;
      readoutMetres = depthForColumnProgress(progressTop, thermoclineProgress);
    } else {
      progressTop = scrollProgress(window.scrollY, scrollableHeight);
      const progressBottom = scrollProgress(window.scrollY + viewportHeight, scrollableHeight);
      depthTop = depthAt(band, progressTop);
      depthBottom = depthAt(band, progressBottom);
      readoutMetres = depthTop;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, viewportHeight);
    for (let i = 0; i < GRADIENT_STOPS; i++) {
      const t = i / (GRADIENT_STOPS - 1);
      const metres = depthTop + (depthBottom - depthTop) * t;
      gradient.addColorStop(t, rgbString(colourAtDepth(metres)));
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, window.innerWidth, viewportHeight);

    const frame: WaterFrame = {
      ctx,
      width: window.innerWidth,
      height: viewportHeight,
      time,
      depthTop,
      depthBottom,
    };
    for (const effect of EFFECTS) {
      effect(frame);
    }

    const roundedMetres = Math.round(readoutMetres);
    const metresUnchanged = lastDispatchedMetres !== null && roundedMetres === lastDispatchedMetres;
    const progressUnchanged =
      lastDispatchedProgress !== null &&
      Math.abs(progressTop - lastDispatchedProgress) < DEPTH_DISPATCH_PROGRESS_EPSILON;

    if (forceDepthDispatch || !metresUnchanged || !progressUnchanged) {
      lastDispatchedMetres = roundedMetres;
      lastDispatchedProgress = progressTop;
      forceDepthDispatch = false;
      window.dispatchEvent(
        new CustomEvent('water:depth', {
          detail: { metres: readoutMetres, progress: progressTop },
        })
      );
    }
  }

  // The animation loop. Stops when the tab is hidden and never starts at all
  // under reduced motion — see startLoop.
  function frameStep(timestamp: number): void {
    if (lastTimestamp !== null) {
      time += (timestamp - lastTimestamp) / 1000;
    }
    lastTimestamp = timestamp;
    paint();
    rafId = requestAnimationFrame(frameStep);
  }

  function startLoop(): void {
    if (looping || reducedMotion.matches || document.hidden) {
      return;
    }
    looping = true;
    lastTimestamp = null;
    rafId = requestAnimationFrame(frameStep);
  }

  function stopLoop(): void {
    if (!looping) {
      return;
    }
    looping = false;
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
    }
    rafId = undefined;
    lastTimestamp = null;
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      stopLoop();
    } else {
      startLoop();
    }
  }

  // Under reduced motion, the atmosphere is present but nothing moves: one
  // static frame at time = 0, redrawn on scroll/resize/navigation like any
  // other static paint.
  function onReducedMotionChange(): void {
    if (reducedMotion.matches) {
      stopLoop();
      time = 0;
      paint();
    } else {
      startLoop();
    }
  }

  // Coalesce scroll/resize bursts into a single paint per frame, rather than
  // a continuous loop: this is a scheduler, not an animation.
  let repaintScheduled = false;
  function scheduleRepaint(): void {
    if (repaintScheduled) {
      return;
    }
    repaintScheduled = true;
    requestAnimationFrame(() => {
      repaintScheduled = false;
      paint();
    });
  }

  function onScroll(): void {
    scheduleRepaint();
  }

  function onResize(): void {
    resize();
    scheduleRepaint();
  }

  // The canvas is transition:persist'd across navigations, so this module's
  // top-level mount only runs once; it does not re-run on later navigations.
  // Recompute the band and repaint from here instead.
  function onAfterSwap(): void {
    band = bandForPath(location.pathname);
    updateThermoclineY();
    forceDepthDispatch = true;
    paint();
  }

  // Paint synchronously on mount so the first frame is correct even if no
  // scroll or resize event ever fires, then start the loop (a no-op under
  // reduced motion or in a background tab).
  resize();
  paint();
  startLoop();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('astro:after-swap', onAfterSwap);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener('change', onReducedMotionChange);

  const teardown = (): void => {
    stopLoop();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('astro:after-swap', onAfterSwap);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.removeEventListener('change', onReducedMotionChange);
    teardowns.delete(canvas);
  };

  teardowns.set(canvas, teardown);
  return teardown;
}
