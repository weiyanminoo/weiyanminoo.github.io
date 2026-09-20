// Paints the water column onto a full-viewport canvas. Repaints on scroll,
// resize, and after navigation — no animation loop yet. Phase 5 adds
// caustics, light shafts, marine snow, a shoal and a dither overlay, driven
// by an animation loop added then; add those as further draw calls inside
// `paint` below, not by restructuring this module.

import { bandForPath, depthAt, type Band } from './depth';
import { colourAtDepth, rgbString } from './palette';

const GRADIENT_STOPS = 12;
const MAX_DEVICE_PIXEL_RATIO = 2;

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

  let band: Band = bandForPath(location.pathname);

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    // Drawing operations below are then expressed in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paint(): void {
    const viewportHeight = window.innerHeight;
    const scrollableHeight = document.documentElement.scrollHeight - viewportHeight;
    const progressTop = scrollProgress(window.scrollY, scrollableHeight);
    const progressBottom = scrollProgress(window.scrollY + viewportHeight, scrollableHeight);
    const depthTop = depthAt(band, progressTop);
    const depthBottom = depthAt(band, progressBottom);

    const gradient = ctx.createLinearGradient(0, 0, 0, viewportHeight);
    for (let i = 0; i < GRADIENT_STOPS; i++) {
      const t = i / (GRADIENT_STOPS - 1);
      const metres = depthTop + (depthBottom - depthTop) * t;
      gradient.addColorStop(t, rgbString(colourAtDepth(metres)));
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, window.innerWidth, viewportHeight);

    window.dispatchEvent(
      new CustomEvent('water:depth', {
        detail: { metres: depthTop, progress: progressTop },
      })
    );
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
    paint();
  }

  // Paint synchronously on mount so the first frame is correct even if no
  // scroll or resize event ever fires.
  resize();
  paint();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('astro:after-swap', onAfterSwap);

  const teardown = (): void => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('astro:after-swap', onAfterSwap);
    teardowns.delete(canvas);
  };

  teardowns.set(canvas, teardown);
  return teardown;
}
